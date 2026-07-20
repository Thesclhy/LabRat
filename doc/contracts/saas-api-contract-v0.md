# SaaS API Contract v0

Status: active
Last reviewed: 2026-07-16

This contract describes the server-first API that is implemented by `backend/src/saas/routes/saasRoutes.js`. The authoritative scientific path is:

```text
FileObject -> SourceDocument -> WorkbookReviewSession
  -> accepted WorkbookUnderstanding
  -> reviewed DataPlan -> accepted DataSnapshot
  -> ExperimentIdentity/SnapshotHead -> Experiment Browser
```

Chart creation is currently supported only for immutable SourceDocument extracts. DataSnapshot-backed chart planning is a later milestone.

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
  "workbookUnderstandings": [],
  "dataPlans": [],
  "dataSnapshots": [],
  "experimentSnapshotHeads": [],
  "browserViews": [],
  "agentRuns": [],
  "analysisThreads": [],
  "chartProposalSets": [],
  "chartSpecs": [],
  "manuscripts": []
}
```

The state response must not contain raw workbook grids, full DataSnapshot records, or projected Browser rows.

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
POST /api/source-documents/:sourceDocumentId/extract-preview
POST /api/source-regions/:sourceRegionId/extract-preview
```

Rules:

- Reads are bounded and project-authorized.
- Range responses preserve sheet, A1 range, row/column coordinates, values, formulas, merged-cell membership/ranges, and source refs when available.
- Query and extract preview endpoints are read-only and cannot create accepted data.
- Oversized requests return an explicit validation error instead of silently truncating scientific evidence.

## Workbook Review And Understanding

```text
GET  /api/projects/:projectId/workbook-review-sessions
POST /api/projects/:projectId/workbook-review-sessions
GET  /api/workbook-review-sessions/:sessionId
POST /api/workbook-review-sessions/:sessionId/revisions
POST /api/workbook-review-sessions/:sessionId/confirm
GET  /api/projects/:projectId/workbook-understandings
```

Revision request:

```json
{
  "message": "The first row is the header and each later row is one experiment.",
  "revisionMode": "replace_current",
  "activeDraftRegionId": "draft_region_1",
  "regions": [
    {
      "id": "draft_region_1",
      "sheetName": "Runs",
      "range": "A1:H5",
      "kind": "experiment_table"
    }
  ],
  "interpretationPatch": {}
}
```

Confirmation rules:

- Every experiment-bearing fact must have validated structured interpretation.
- Experiment identity must be explicit; blank or duplicate aliases block confirmation.
- Unresolved units and low-confidence semantics require user correction or acknowledgement.
- Confirmation creates an accepted `WorkbookUnderstanding` only. It does not publish Browser rows or create output artifacts.

## Evidence Retrieval And DataPlan

```text
POST /api/projects/:projectId/evidence/retrieve
POST /api/projects/:projectId/data-plans/draft
POST /api/projects/:projectId/data-plans/publish
GET  /api/projects/:projectId/data-plans
GET  /api/projects/:projectId/data-snapshots
```

Evidence retrieval returns accepted WorkbookUnderstanding regions as usable evidence. Unconfirmed candidates may be returned as suggestions but must use `canUseForDataPlan: false`.

Draft request:

```json
{
  "intent": "experiment_browser_publish",
  "workbookUnderstandingIds": ["workbook_understanding_1"],
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

## Agent Planning

```text
POST /api/projects/:projectId/agent/plan
GET  /api/projects/:projectId/agent/runs
POST /api/projects/:projectId/agent/runs
GET  /api/agent-runs/:agentRunId
POST /api/agent-runs/:agentRunId/confirm
POST /api/agent-runs/:agentRunId/cancel
```

Agent requests pass through the backend intent router. Explicit workbook upload, Experiment Browser navigation, Manuscript commands, and source-extract evidence requests retain deterministic priority. Project-purpose and project-overview questions may complete as a read-only `project_summary` AgentRun with no actions. Trends, comparisons, derived calculations, statistics, and accepted-data chart requests return `mode: "analysis_planning"` with no Browser action and create a durable AnalysisThread. When accepted active experiment data and a backend model provider are available, the response also contains the first backend-validated `currentPlanRevision`. Unknown requests return clarification instead of using Experiment Browser as a fallback.

`POST /api/projects/:projectId/agent/runs` returns user-facing text in the top-level `reply` field plus nullable `analysisThread` and `currentPlanRevision` fields. Provider configuration and credentials are backend-only. AgentRun usage stores provider, model, token, and latency metadata while planning records visible workflow steps rather than hidden chain-of-thought.

The backend owns an internal AnalysisToolRegistry with `get_project_analysis_context`, `list_analysis_fields`, `resolve_experiment_scope`, `preview_analysis_selection`, `inspect_analysis_selection`, and `validate_analysis_plan`. These are project-authorized planning tools, not public mutation routes. The registry exposes no execution operation.

## Reviewed Analysis Planning

```text
POST /api/projects/:projectId/analysis-threads
GET  /api/projects/:projectId/analysis-threads
GET  /api/analysis-threads/:analysisThreadId
POST /api/analysis-threads/:analysisThreadId/plan-revisions
GET  /api/analysis-plan-revisions/:planRevisionId/selection
POST /api/analysis-plan-revisions/:planRevisionId/accept
POST /api/analysis-runs/:analysisRunId/execute
GET  /api/analysis-runs/:analysisRunId
GET  /api/analysis-runs/:analysisRunId/result-preview
POST /api/analysis-runs/:analysisRunId/revise
```

Rules:

- Thread/revision mutations require `editor`; reads require `viewer`.
- A normal modification request posts only `feedback`; the backend model chooses a revised accepted-data scope/calculation, and backend tools replace model-supplied selection/source/program hashes with exact validated values.
- Each revision stores the exact plan, complete frozen AnalysisSelection, non-contiguous source rectangles, Python source/hash, dependency/selection/plan hashes, and visible feedback. Creating revision N marks the prior awaiting-review revision `superseded` without changing its payload.
- `GET .../selection` is paginated with a maximum of 200 records and returns exact source rectangles plus coverage and hashes.
- Plan acceptance requires an `Idempotency-Key` header and exact `planHash`, `selectionHash`, and `dependencyHash` request fields.
- Acceptance re-resolves current active experiment heads. Hash changes return `409 analysis_plan_stale`; accepting a non-current revision returns `409 analysis_plan_revision_mismatch`.
- Successful acceptance atomically marks the revision accepted, advances the thread to `executing`, writes an audit event, and creates one immutable `status: queued` AnalysisRun. Same-key/same-request retries return the same run; conflicting reuse returns `409`.
- Plan acceptance does not run Python, create an AnalysisResult, create a ChartSpec, or place manuscript content.
- Execution transactionally locks and verifies the frozen active-head refs while claiming a queued run, then rechecks dependency, selection, input, program, runtime, and Python-policy hashes. Changed heads terminally produce `validation_failed` so the user can revise against current accepted data.
- A running claim uses an internal token and six-minute lease. An expired claim may be recovered with a new token; an old worker cannot finalize after recovery. The claim token is never returned by public summaries.
- Valid execution output is bounded and checked for supported `experiment_traces` encoding, finite declared output fields, plottable x/y types and lengths, exact experiment/snapshot identity, accepted-record lineage, declared units, complete output-or-exclusion input accounting, visible exclusion reasons, missing-value policy, runtime/hash agreement, and declared invariants. Only a valid output creates one immutable `status: awaiting_review` AnalysisResult and advances the run/thread to `awaiting_result_review`.
- Executor or validation failure records a terminal run status and audit event but creates no AnalysisResult or ChartSpec. Repeating `execute` on a terminal run returns the original state with `idempotentReplay: true`.
- Result preview is separately paginated: result rows and source refs are capped at 200 per request and traces at 500. Lineage is limited to the returned row/trace page. Ordinary run detail returns result metadata and source-ref counts rather than full result/evidence arrays.
- Revision requires feedback and, when a result exists, its exact visible `resultHash`. It sends bounded result/validation context to backend planning and creates a later immutable AnalysisPlanRevision; the prior result remains unchanged.
- `LABRAT_ANALYSIS_EXECUTOR` defaults to `disabled`. `local` is non-production only; production execution requires a configured HTTPS hardened worker. Executor command, endpoint, timeout, and provider credentials are backend-only configuration.

## Source-Backed Charts

```text
GET   /api/projects/:projectId/source-extract-proposals
POST  /api/projects/:projectId/source-extract-proposals
PATCH /api/source-extract-proposals/:proposalId
POST  /api/source-extract-proposals/:proposalId/chart-proposal
POST  /api/projects/:projectId/charts/interpret
GET   /api/projects/:projectId/chart-proposal-sets
PATCH /api/chart-proposal-sets/:chartProposalSetId
POST  /api/projects/:projectId/chart-specs/from-proposal
GET   /api/projects/:projectId/chart-specs
```

Rules:

- Chart interpretation may resolve only explicit SourceDocument evidence and produces reviewable source extract/chart proposals.
- A durable ChartSpec requires `origin: "source_extract"`, exact source refs, and immutable `sourceSnapshot.rows` or `sourceSnapshot.series`.
- Cross-experiment source charts use explicit series with experiment ids/labels and source snapshot rows.
- Non-source proposals return `409 data_snapshot_chart_not_implemented` until the DataSnapshot chart milestone exists.
- Project ChartSpec listing exposes only source-backed specs.

## Manuscripts

```text
GET   /api/projects/:projectId/manuscripts
POST  /api/projects/:projectId/manuscripts
PATCH /api/manuscripts/:manuscriptId
```

Manuscript chart blocks store `chartSpecId`, an immutable `chartSpecSnapshot`, a user-selected `chartView`, and editable chart layout. Existing blocks can render from the stored source snapshot even when the live ChartSpec is no longer listed.

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
/api/source-extract-proposals/:proposalId/promote
```

No compatibility dual-write or local-data migration is required for these retired paths.
