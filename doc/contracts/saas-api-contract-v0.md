# SaaS API Contract v0

Status: active
Last reviewed: 2026-07-20

This contract describes the server-first API that is implemented by `backend/src/saas/routes/saasRoutes.js`. The authoritative scientific path is:

```text
FileObject -> SourceDocument -> WorkbookReviewSession
  -> WorkbookReviewRegion -> accepted RegionUnderstandingRevision
  -> reviewed DataPlan -> accepted DataSnapshot
  -> ExperimentIdentity/SnapshotHead -> Experiment Browser
```

Durable charts use reviewed analysis results selected from confirmed RegionUnderstandingRevisions and/or accepted active DataSnapshot records.

## General Rules

- All project resources are scoped by `labId` and `projectId`.
- `viewer` can read, `editor` can create reviewed scientific artifacts, and `lab_admin`/super-admin manage users and labs.
- Raw files and indexed source evidence are immutable.
- AI or deterministic agents may draft reviewable actions, but scientific writes require explicit user confirmation.
- Accepted values must preserve exact source refs, dependency hashes, warnings, and actor/timestamp metadata.
- Large cell grids and full experiment series are fetched lazily through bounded endpoints, not project state hydration.

## Auth And Administration

Implemented endpoints:

```text
POST  /api/auth/login
POST  /api/auth/logout
GET   /api/auth/me
GET   /api/admin/labs
POST  /api/admin/labs
GET   /api/admin/users
POST  /api/admin/users
PATCH /api/admin/users/:userId
POST  /api/admin/users/:userId/reset-password
GET   /api/labs
```

Sessions use an HTTP-only cookie. Production configuration must provide a non-default session secret and must not enable development seed accounts.

## Projects

```text
GET   /api/projects
POST  /api/projects
GET   /api/projects/:projectId
PATCH /api/projects/:projectId
PATCH /api/projects/:projectId/profile
GET   /api/projects/:projectId/state
```

`GET /state` returns bounded project summaries:

```json
{
  "project": {},
  "projectProfile": {},
  "fileObjects": [],
  "importRuns": [],
  "sourceDocuments": [],
  "workbookReviewSessions": [],
  "workbookReviewRegions": [],
  "regionUnderstandings": [],
  "dataPlans": [],
  "dataSnapshots": [],
  "experimentSnapshotHeads": [],
  "browserViews": [],
  "agentRuns": [],
  "analysisThreads": [],
  "chartSpecs": [],
  "manuscripts": []
}
```

The state response must not contain raw workbook grids, full DataSnapshot records, or projected Browser rows.

Each item from `GET /api/projects` includes a bounded `workflowSummary` with
`publishedExperimentCount` and supported `chartSpecCount`. Project-list clients
must use these server counts before loading full project state rather than
displaying zero-value placeholders.

## File Upload And Source Indexing

```text
GET  /api/projects/:projectId/files
POST /api/projects/:projectId/files
GET  /api/projects/:projectId/import-runs
POST /api/projects/:projectId/import-runs
GET  /api/projects/:projectId/source-documents
```

Upload creates a project-owned `FileObject`. Starting an import run scans the workbook and creates or reuses a deterministic `SourceDocument`, `SourceRegion` records, and source index blobs. It does not publish experiments or create charts.

## Source Evidence

```text
GET  /api/source-documents/:sourceDocumentId/regions
POST /api/source-documents/:sourceDocumentId/query
POST /api/source-documents/:sourceDocumentId/range
```

Rules:

- Reads are bounded and project-authorized.
- Range responses preserve sheet, A1 range, row/column coordinates, values, formulas, merged-cell membership/ranges, and source refs when available.
- Query and range endpoints are read-only and cannot create accepted data.
- Oversized requests return an explicit validation error instead of silently truncating scientific evidence.

## Workbook Region Review And Understanding

```text
GET  /api/projects/:projectId/workbook-review-sessions
POST /api/projects/:projectId/workbook-review-sessions
GET  /api/workbook-review-sessions/:sessionId
GET  /api/workbook-review-sessions/:sessionId/regions
POST /api/workbook-review-sessions/:sessionId/regions
POST /api/workbook-review-sessions/:sessionId/regions/:regionId/interpret
GET  /api/workbook-review-sessions/:sessionId/regions/:regionId/revisions
POST /api/workbook-review-sessions/:sessionId/regions/:regionId/revisions
POST /api/workbook-review-sessions/:sessionId/regions/:regionId/confirm
POST /api/workbook-review-sessions/:sessionId/regions/:regionId/ignore
DELETE /api/workbook-review-sessions/:sessionId/regions/:regionId
GET  /api/projects/:projectId/region-understandings?status=accepted
```

Region creation request:

```json
{
  "sourceDocumentId": "source_document_1",
  "sheetName": "Runs",
  "range": "A1:H5",
  "selectionMethod": "drag_select",
  "deferInterpretation": true,
  "idempotencyKey": "region_create_1"
}
```

When `deferInterpretation` is `true`, creation immediately returns the durable
region with `reviewStatus: "interpreting"` and no current revision. The client
then starts the bounded model call separately:

```json
{
  "expectedRegionVersion": 1,
  "description": "",
  "semanticType": "generic_table",
  "idempotencyKey": "region_interpret_1"
}
```

Revision and confirmation requests:

```json
{
  "feedback": "The first row is the header and each later row is one experiment.",
  "previousRevisionId": "region_understanding_revision_1",
  "expectedRegionVersion": 1,
  "idempotencyKey": "region_revision_2"
}
```

```json
{
  "revisionId": "region_understanding_revision_2",
  "expectedRegionVersion": 2,
  "idempotencyKey": "region_confirm_2"
}
```

Rules:

- Creating or revising one region sends the backend model only that bounded range, limited neighboring cells, and a workbook manifest. The complete workbook is never model context.
- Deferred creation makes the exact sheet/range and version available before the model call so the UI can show an immediate pending card and permit version-checked Ignore/Delete. A late interpretation is discarded when the region changed or became inactive while the model was running.
- Each region owns immutable numbered revisions plus separate current and accepted revision pointers.
- Confirm applies to one exact revision. Ignore and logical delete apply to one exact version and do not erase revision history or downstream artifacts.
- `WorkbookReviewSession` groups regions for one source workbook; there is no workbook-wide confirmation state.
- The retired aggregate session revision/confirm and project `workbook-understandings` routes return `404`.
- Region confirmation does not publish Browser rows or create output artifacts.

## Evidence Retrieval And DataPlan

```text
POST /api/projects/:projectId/evidence/retrieve
POST /api/projects/:projectId/data-plans/draft
POST /api/projects/:projectId/data-plans/publish
GET  /api/projects/:projectId/data-plans
GET  /api/projects/:projectId/data-snapshots
```

Evidence retrieval returns exact active accepted RegionUnderstandingRevisions as usable evidence. Unconfirmed candidates may be returned as suggestions but must use `canUseForDataPlan: false`.

Draft request:

```json
{
  "intent": "experiment_browser_publish",
  "regionUnderstandingRevisionIds": ["region_understanding_revision_2"],
  "identityDecisions": [
    {
      "sourceAlias": "Exp33",
      "action": "create"
    }
  ]
}
```

Draft response contains a transient `labrat.dataPlan.v2` plus deterministic `labrat.dataSnapshot.v2` preview, dependency hash, preview hash, warnings, skipped rows, and source refs. Field bindings preserve accepted `headerSourceRefs` separately from each emitted value's `sourceRefs`, including every parent and leaf cell used to interpret grouped headers. Drafting performs no durable scientific write.

Publish request:

```json
{
  "idempotencyKey": "publish_20260716_001",
  "dataPlan": {},
  "identityDecisions": [],
  "expectedPreviewHash": "sha256_preview",
  "expectedDependencyHash": "sha256_dependency"
}
```

Publish rules:

- Required role: `editor` or above.
- The backend re-reads source evidence and deterministically re-executes the plan.
- Dependency/preview mismatch returns a stale-review error before writes.
- One atomic transaction creates the accepted DataPlan, immutable DataSnapshot, explicit experiment identities, affected snapshot heads, idempotency receipt, and audit event.
- Reusing an idempotency key with the same request returns the recorded response; reusing it for another request is rejected.

## Experiment Browser

```text
GET /api/projects/:projectId/experiment-browser
GET /api/projects/:projectId/experiments/:experimentId
```

List query parameters:

```text
cursor
limit
search
sortField
sortDirection
filters (JSON)
```

The list response contains one bounded row per active experiment snapshot head, a stable field catalog, recommended columns, and an opaque next cursor. Series point arrays are excluded.

The detail endpoint lazily returns the complete active experiment record, scalar values, series inventory/points, warnings, and exact source refs. Cross-project and inactive identities return not found.

## Personal Browser Views

```text
GET    /api/projects/:projectId/browser-views
POST   /api/projects/:projectId/browser-views
PATCH  /api/projects/:projectId/browser-views/:browserViewId
DELETE /api/projects/:projectId/browser-views/:browserViewId
```

BrowserViews are owner-scoped display state only. They may store visible column ids/order/widths, filters, sort, selected experiment ids, and default status. They must never store authoritative scientific values.

## LabRat AgentRun

```text
GET  /api/projects/:projectId/agent/runs
POST /api/projects/:projectId/agent/runs
GET  /api/agent-runs/:agentRunId
POST /api/agent-runs/:agentRunId/cancel
```

Agent requests pass through the backend intent router and have three product dispositions: workbook upload/region review, read-only project question answering, and reviewed analysis/chart planning. Explicit Browser navigation may still return a deterministic navigation reply, but it is not a fallback for project questions. Every chart, trend, comparison, derived calculation, and explicit Excel-range chart request returns `mode: "analysis_planning"`, creates a durable AnalysisThread, and selects only active confirmed workbook regions. Publishing a DataSnapshot is not required for chart planning. Unknown requests return clarification.

`POST /api/projects/:projectId/agent/runs` returns user-facing text in the top-level `reply` field plus nullable `analysisThread` and `currentPlanRevision` fields. Provider configuration and credentials are backend-only. AgentRun usage stores provider, model, token, and latency metadata while planning records visible workflow steps rather than hidden chain-of-thought.

The planning provider receives a bounded catalog of active confirmed
RegionUnderstandingRevisions and may call `inspect_source_range` to page through
their cells. After plan acceptance, the code-generation provider receives a
manifest plus initial pages of the materialized multi-table input and may call
read-only `inspect_run_input` for additional pages. Neither tool can execute,
accept, publish, or mutate source evidence.

## Reviewed Analysis Planning

```text
POST /api/projects/:projectId/analysis-threads
GET  /api/projects/:projectId/analysis-threads
GET  /api/projects/:projectId/analysis-capabilities
GET  /api/analysis-threads/:analysisThreadId
POST /api/analysis-threads/:analysisThreadId/retry
POST /api/analysis-threads/:analysisThreadId/plan-revisions
GET  /api/analysis-plan-revisions/:planRevisionId/selection
POST /api/analysis-plan-revisions/:planRevisionId/accept
POST /api/analysis-runs/:analysisRunId/execute
GET  /api/analysis-runs/:analysisRunId
GET  /api/analysis-runs/:analysisRunId/result-preview
POST /api/analysis-runs/:analysisRunId/revise
POST /api/analysis-runs/:analysisRunId/accept-and-create-chart
```

Rules:

- Thread/revision mutations require `editor`; reads require `viewer`.
- The project capability read returns only bounded public model/executor status
  and confirmed-region plus accepted snapshot/head counts. It never returns provider credentials,
  worker secrets, workbook values, or Python command configuration. Frontends
  fail closed while this capability is loading or unavailable.
- Retry is editor-only and valid only for a thread linked from an AgentRun with
  an `analysis_evidence_required` warning, no reviewable revision/run, and at
  least one active confirmed region. It preserves the original request, drafts
  from current confirmed evidence, and never accepts, executes, or publishes automatically.
  `Idempotency-Key` is required. A durable receipt and six-minute store lease
  prevent concurrent provider calls; same-key/same-request replay returns the
  existing revision, conflicting reuse returns `409`, failed drafting releases
  the receipt for retry, and an abandoned claim becomes recoverable after its
  lease expires. A revision durably created before receipt completion is
  reconciled and replayed without another provider call.
- A normal modification request posts only `feedback`; the backend model chooses revised exact workbook selections and calculation/chart meaning.
- Initial and revised model drafts pass deterministic ownership/range and plan
  validation before an AnalysisPlanRevision is persisted. On the first
  repairable draft failure, the backend may make one bounded provider repair
  request containing the exact validation codes and messages
  plus the rejected structured draft. Repair never accepts a plan, runs Python,
  or publishes an artifact. A second failure returns a durable planning warning
  with bounded error details so the frontend can name the policy and offending
  line instead of showing only a generic provider/runtime error.
- Each revision stores exact `sourceSelections`, structured `reviewPlan`, readable
  `displayPlan`, derived non-contiguous source rectangles, validation, and
  visible feedback. It stores no Python, input values, field mapping, expected
  result table, or user-review hash. Creating revision N marks the prior
  awaiting-review revision `superseded` without changing its payload.
- Each source selection names one accepted RegionUnderstandingRevision,
  SourceDocument, workbook name, worksheet, and exact rectangular range. One
  selection becomes one `inputs.tables` item. Selections may span multiple
  files, sheets, and non-contiguous ranges.
- `GET .../selection` returns the exact source selections and derived source
  rectangles for the Source review page; it returns no result records.
- Plan acceptance requires only an `Idempotency-Key` header. The request body
  does not echo plan, selection, dependency, or hash fields.
- Acceptance re-resolves every selected range against the current active
  accepted region revision; stale or out-of-region selections are rejected.
- Successful acceptance atomically marks the revision accepted, advances the thread to `executing`, writes an audit event, and creates one immutable `status: queued` AnalysisRun. Same-key/same-request retries return the same run; conflicting reuse returns `409`.
- Plan acceptance does not generate or run Python, create an AnalysisResult,
  create a ChartSpec, or place manuscript content.
- Execution claims the queued run, re-resolves source selections, and
  materializes complete typed/display/formula grids. SourceDocument reads remain
  individually bounded, but the analysis selection has no 500-cell aggregate
  limit; configurable executor input/output limits remain.
- Only after materialization does the model generate `labrat-python-v2` with
  entrypoint `analyze(inputs, labrat)`. Programs read the dictionary
  `inputs["tables"]`; large inputs can be inspected with `inspect_run_input`.
  Python policy errors include the policy name, offending line, and reason.
- A running claim uses an internal token and six-minute lease. An expired claim may be recovered with a new token; an old worker cannot finalize after recovery. The claim token is never returned by public summaries.
- Python output is authoritative Plotly `{ data, layout }` plus readable
  `exclusions` and optional declared-constraint `checks`. Backend validation
  checks JSON serialization, finite values, equal non-empty x/y arrays,
  trace/point/payload limits, safe Plotly keys and strings, source ownership,
  stable unique `traceId` values, and only invariants explicitly stated in the
  reviewed plan. Missing trace ids are assigned deterministically by output
  order. The backend does not reconstruct Plotly from result rows, remap X/Y,
  require field ids, or reject one-to-many reshaping.
- Executor or validation failure records a terminal run status and audit event but creates no AnalysisResult or ChartSpec. Repeating `execute` on a terminal run returns the original state with `idempotentReplay: true`.
- Result preview returns complete validated Plotly, summary, exclusions,
  validation, and the result id needed for acceptance. It does not return the
  former technical result table, row lineage, or user-review hashes.
- Revision requires feedback only. It sends bounded prior run/result validation
  context to planning and creates a later immutable PlanRevision; prior runs and
  results remain unchanged.
- Result publication requires `editor`, an `Idempotency-Key`, the exact
  `analysisResultId`, and at least one reviewed `defaultVisibleTraceIds` value.
  Unknown or empty curve selections create no writes.
- Successful result publication atomically marks the existing AnalysisResult
  `accepted`, moves its AnalysisRun and AnalysisThread to `completed`, and
  creates one `labrat.chartSpec.v3` `origin: analysis_result` ChartSpec with
  complete authoritative Plotly, source selections, a flat trace catalog, and
  the reviewed default visible curves.
- `LABRAT_ANALYSIS_EXECUTOR` defaults to `disabled`. `local` is non-production only; production execution requires a valid configured HTTPS hardened worker. Executor command, endpoint, timeout, and provider credentials are backend-only configuration.
- Closing the AgentRun request aborts any in-flight backend provider request.
  The frontend may expose this as a phase/elapsed-time status with an explicit
  cancel action; cancellation does not fall through to a second planner.

Status flow:

```text
AnalysisThread planning
  -> awaiting_plan_review
  -> executing
  -> awaiting_result_review
  -> completed

AnalysisPlanRevision awaiting_review -> superseded | accepted
AnalysisRun queued -> running -> failed | validation_failed | awaiting_result_review -> completed
AnalysisResult awaiting_review -> accepted
```

## Reviewed Analysis Charts

```text
GET   /api/projects/:projectId/chart-specs
GET   /api/chart-specs/:chartSpecId
```

Rules:

- A durable ChartSpec requires `labrat.chartSpec.v3`,
  `origin: "analysis_result"`, exact analysis artifact ids, reviewed source
  selections, complete immutable Plotly `data/layout`, a matching flat trace
  catalog, and a non-empty reviewed default-visible trace subset.
- ChartSpecs can only be created by accepting the exact awaiting-review
  AnalysisResult and reviewed visible curve ids.
- Project ChartSpec state/list responses omit large trace x/y arrays, include trace metadata/point counts and `detailRequired: true`, and load complete arrays from `GET /api/chart-specs/:chartSpecId`.
- Approved-chart management lists durable ChartSpecs directly; there is no proposal collection.

## Manuscripts

```text
GET   /api/projects/:projectId/manuscripts
POST  /api/projects/:projectId/manuscripts
PATCH /api/manuscripts/:manuscriptId
```

Manuscript chart blocks store `chartSpecId`, a complete immutable `chartSpecSnapshot`, placement-local `chartView.visibleTraceIds`, and editable chart layout. If a project/list ChartSpec has `detailRequired: true`, the frontend must load `GET /api/chart-specs/:chartSpecId` before insertion and snapshot the complete artifact. Existing blocks render from their stored snapshot even when the live ChartSpec is no longer listed. Two placements of one ChartSpec may show different trace subsets; visibility changes do not mutate or delete traces from the shared ChartSpec.

## Retired Endpoints

The following paths are intentionally absent and return `404`:

```text
/api/import/scan
/api/import/normalize
/api/import/semantic-map
/api/charts/propose
/api/charts/interpret
/api/projects/:projectId/dataset-commits
/api/projects/:projectId/mapping-sets
/api/projects/:projectId/analysis-views
/api/projects/:projectId/observation-series
/api/projects/:projectId/data/resolve-query
/api/projects/:projectId/agent/plan
/api/agent-runs/:agentRunId/confirm
/api/projects/:projectId/charts/interpret
/api/projects/:projectId/source-extract-proposals
/api/source-extract-proposals/:proposalId
/api/projects/:projectId/chart-proposal-sets
/api/chart-proposal-sets/:chartProposalSetId
/api/projects/:projectId/chart-specs/from-proposal
/api/source-extract-proposals/:proposalId/promote
```

No compatibility dual-write or local-data migration is required for these retired paths.
