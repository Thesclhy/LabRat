# SaaS API Contract v0

Status: active
Last reviewed: 2026-08-18

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
  "projectBrowserConfig": {},
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
GET  /api/source-documents/:sourceDocumentId/cell-classes?sheetName=&range=
```

Rules:

- Reads are bounded and project-authorized.
- Range responses preserve sheet, A1 range, row/column coordinates, values, formulas, merged-cell membership/ranges, and source refs when available. A formula whose Excel result is an error (`#DIV/0!`, `#REF!`, ...) has `type: "error"`, `rawValue: null`, its formula text, and the error string as `formattedValue`; the Excel error code is never exposed as a number.
- Query and range endpoints are read-only and cannot create accepted data.
- Oversized requests return an explicit validation error instead of silently truncating scientific evidence.

Cell classes are derived deterministically from the stored formula text of the
whole workbook without evaluating any formula. The response is
`labrat.sourceCellClasses.v1`:

```json
{
  "sheetName": "Sheet1",
  "range": "P31:BA32",
  "cells": [
    { "address": "Q32", "row": 32, "col": 17, "cellClass": "terminal", "formula": "F14", "formattedValue": "0.5237", "precedentCount": 1, "dependentCount": 0 }
  ],
  "summary": { "terminal": 37, "intermediate": 0, "input": 0, "constant": 38, "blank": 1 },
  "provenance": { "schemaVersion": "labrat.regionProvenance.v1" }
}
```

Class meanings: `terminal` is a formula cell nothing else references (a final
result), `intermediate` is a formula cell that feeds other formulas, `input`
is a typed value used by formulas, `constant` is a typed value or label used by
nothing, and `blank` is empty. The range is limited to the same 500-cell bound
as `/range`. Workbooks above 250,000 indexed cells skip the graph and return
`graphTruncated: true` with a `formula_graph_skipped` warning.

## Workbook Region Review And Understanding

```text
GET  /api/projects/:projectId/workbook-review-sessions
POST /api/projects/:projectId/workbook-review-sessions
GET  /api/workbook-review-sessions/:sessionId
DELETE /api/workbook-review-sessions/:sessionId
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

- Creating a WorkbookReviewSession never waits for region LLM calls. It
  persists all deterministic candidate regions with `reviewStatus:
  "interpreting"`, returns `interpretationDeferred: true`, and lets Workbook
  Review schedule the per-region interpret endpoint.
- A WorkbookReviewRegion persists a bounded `interpretationHint` containing
  its initial semantic type and description so pending work can resume after a
  refresh without relying on browser memory.
- Creating or revising one region sends the backend model only that bounded range, limited neighboring cells, and a workbook manifest. The complete workbook is never model context.
- Each inspection cell sent to the model carries its deterministic
  `cellClass`, and the request carries a bounded `region.provenance` (class
  summary, one-level derivation text, shared upstream inputs, typed-over
  cells, warning codes). The model may return `seriesPatches` beside
  `fieldPatches`; the backend validates each patch against the selected
  range and merges it into `interpretation.series` with `orientation:
  "header_row_categories"` (one header row of categories above one value row,
  `xHeaderRange`/`yValueRange`, `pointCount`) or `"column_pair"`.
- Every stored revision carries `interpretation.provenance`
  (`labrat.regionProvenance.v1`) computed by the backend, and its warnings
  (`region_mostly_intermediate_cells`, `region_mostly_input_cells`,
  `formula_chain_broken`, `formula_graph_skipped`) are appended to the
  revision and region warnings. Provenance never blocks confirmation; the
  values are the cached formula results as stored in the workbook.
- Deferred creation makes the exact sheet/range and version available before the model call so the UI can show an immediate pending card and permit version-checked Ignore/Delete. A late interpretation is discarded when the region changed or became inactive while the model was running.
- Workbook Review schedules active pending regions with at most three
  concurrent model requests. The active region is first, individual failures
  do not stop later regions, and failed cards require explicit retry.
- Each region owns immutable numbered revisions plus separate current and accepted revision pointers.
- Confirm applies to one exact revision. Ignore and logical delete apply to one exact version and do not erase revision history or downstream artifacts.
- `WorkbookReviewSession` groups regions for one source workbook; there is no workbook-wide confirmation state.
- Deleting a WorkbookReviewSession is a version-checked logical delete. It
  removes the workbook from active review lists and atomically marks its active
  WorkbookReviewRegions deleted. Immutable source files, prior revisions,
  accepted DataSnapshots, ChartSpecs, and audit history are retained.
- The retired aggregate session revision/confirm and project `workbook-understandings` routes return `404`.
- Region confirmation does not publish Browser rows or create output artifacts.

## Region Extraction Templates

```text
GET  /api/projects/:projectId/region-extraction-templates?includeArchived=
POST /api/projects/:projectId/region-extraction-templates
GET  /api/region-extraction-templates/:templateId
POST /api/region-extraction-templates/:templateId/versions
POST /api/region-extraction-templates/:templateId/archive
POST /api/region-extraction-template-versions/:versionId/matches
```

A RegionExtractionTemplate is a project-owned container with immutable
accepted versions. Each version is compiled from one confirmed
WorkbookReviewRegion and its accepted RegionUnderstandingRevision:

```json
{ "name": "Carbon distribution from LDPE sheet", "description": "", "regionId": "workbook_review_region_1" }
```

The version stores `labrat.layoutSignature.v1` (sheet name, companion sheet
names, anchor range, range shape, header runs such as `C1..C37`, text anchors
inside the region, label anchors within three cells around it, one relative
R1C1 formula shape per formula cell, and an experiment-label rule that reads a
fixed cell such as `A2` and falls back to the filename) plus relative
`semantics` copied from the accepted interpretation (axis, fields, series with
relative ranges, inclusion). Content is hashed; duplicate names or identical
content return `409`.

Matching is read-only and side-effect free. The request lists up to 100
project source documents; the response has one `labrat.regionTemplateMatchReport.v1`
per document with `status` in `exact`, `shifted`, `ambiguous`,
`label_missing`, `formula_mismatch`, `header_mismatch`, or `no_match`, plus
`matchedRange`, `offset`, `experimentLabel` and `labelSource`, header-run
counts, typed-over `formulaMismatches`, upstream `brokenCells`, alternative
blocks, and `eligibleForBatchConfirm` (true only for `exact` and `shifted`).
The template's original position wins when it still matches; other matching
blocks are listed as alternatives. Only shifted candidates in two places is
`ambiguous`. Rules:

- Creating a version requires an active region whose accepted revision is
  current; unconfirmed regions return `409`.
- Editors create, version, archive, and apply; viewers read and match.
- Matching creates no regions, revisions, or sessions.
- Bounded: template regions have at most 600 cells; sheets above 50,000
  indexed cells are skipped with a warning.

Applying and batch confirmation:

```text
POST /api/region-extraction-template-versions/:versionId/apply        (Idempotency-Key)
POST /api/projects/:projectId/workbook-review-regions/confirm-batch
```

`apply` re-matches each listed source document and, for `exact` and `shifted`
results (or the subset in `onlyStatuses`), reuses or creates the workbook's
WorkbookReviewSession, creates one region at the matched range with
`selectionMethod: "template_match"`, `reviewStatus: "awaiting_review"`,
`dataKind` (the template name), `regionExtractionTemplateVersionId`,
`templateMatch` (status, offset, experiment label, link status and candidates),
and `linkedExperimentId` when the label matches exactly one ExperimentIdentity.
It writes revision 1 with `trigger: "template_match"` by rebasing the
template's stored semantics onto the matched range and running it through the
same interpretation validation as a model or user patch, plus backend
provenance. No provider call. The response lists `applied` and `skipped`
entries; a document whose range already holds a template-match region returns
that region with `reason: "already_applied"`, and a manual or confirmed region
at the same range is skipped, so replays are safe.

`confirm-batch` takes `items: [{ regionId, revisionId, expectedRegionVersion,
linkedExperimentId? }]`. Each item is validated on its own: the region must be
a `template_match` region whose report was `exact` or `shifted`, otherwise it
is rejected with `batch_confirm_requires_individual_review`; a supplied
`linkedExperimentId` must belong to the project and is written before the
version-checked confirmation. Each confirmed region gets its own accepted
revision pointer, actor, and audit event, plus one batch audit event.
Failures are reported per item and do not stop the rest.

Region summaries expose `linkedExperimentId`, `dataKind`,
`regionExtractionTemplateVersionId`, and `templateMatch`.

## Linked Data Comparisons

```text
GET  /api/projects/:projectId/linked-data-kinds
POST /api/projects/:projectId/linked-data-comparisons
```

`linked-data-kinds` (viewer) groups accepted, experiment-linked regions by
`dataKind` with per-experiment regions (workbook, sheet, range, template
version, series metadata) plus the project's experiment list, so a picker can
show which experiments still lack a data kind.

`linked-data-comparisons` (editor) takes `{ dataKind, experimentIds,
chartType?, dryRun? }`. The backend deterministically selects, for each
experiment, its most recently confirmed region of that kind and builds an
ordinary workbook-mode chart plan: one exact `sourceSelection` per experiment,
a readable `reviewPlan` whose processing steps describe the header-row or
column-pair series shape recorded on the regions, a `displayPlan` that names
the workbooks and the experiments left out, and a `linkedDataComparison`
block for lineage. Chart type defaults to `grouped_bar` for header-row
category series and `scatter` for column-pair series; any supported chart
type may be requested. With `dryRun: true` the response only previews the
comparison. Otherwise it creates an AnalysisThread (`outputTarget: chart`,
`inputMode: workbook`) and an awaiting-review AnalysisPlanRevision through the
normal validation, then returns both; acceptance, Python generation against
the real materialized tables, result review, and ChartSpec creation follow the
existing reviewed path. No provider call is made for the selection step and
no DataSnapshot is read or written. Unknown kinds return `404`; a request in
which no chosen experiment has linked data returns `422
linked_data_comparison_empty`.

## Evidence Retrieval And Historical Data

```text
POST /api/projects/:projectId/evidence/retrieve
GET  /api/projects/:projectId/data-plans
GET  /api/projects/:projectId/data-snapshots
```

Evidence retrieval returns exact active accepted RegionUnderstandingRevisions as usable evidence. Unconfirmed candidates may be returned as suggestions but must use `canUseForDataPlan: false`.

`GET .../data-plans` is historical read-only provenance. The former
`POST .../data-plans/draft` and `POST .../data-plans/publish` routes are retired
and return `404`. New Experiment Browser data is created only through reviewed
AnalysisThreads and DataSnapshot v4 publication.

## Experiment Browser

```text
GET /api/projects/:projectId/experiment-browser
GET /api/projects/:projectId/experiments/:experimentId
GET  /api/projects/:projectId/experiment-custom-columns
POST /api/projects/:projectId/experiment-custom-columns
PATCH /api/projects/:projectId/experiment-custom-columns/:customColumnId
DELETE /api/projects/:projectId/experiment-custom-columns/:customColumnId
PUT /api/projects/:projectId/experiment-custom-columns/:customColumnId/experiments/:experimentId
```

List query parameters:

```text
cursor
limit
search
sortField
sortDirection
filters (JSON)
starredOnly (boolean; current user's annotations only)
```

The list response contains one bounded row per active experiment snapshot head, a stable field catalog, recommended columns, and an opaque next cursor. Series point arrays are excluded.

Linked workbook data: every accepted, active WorkbookReviewRegion with a
`linkedExperimentId` and `dataKind` contributes to one shared column per data
kind, `linked:<data-kind-slug>` (`role: "linked_data"`, `isLinkedData: true`,
`valueType: "string"`). The cell value is a readable
`"<workbook> · <sheet>!<range>"` list, so search, `contains`, `is_empty`,
`not_empty`, and sort work unchanged, and the cell carries `linkedRegions`
(region id, session id, source document id, workbook name, sheet, range,
template version, series labels). Rows also carry `linkedRegionCount`.
Experiment detail adds `linkedRegions` for that experiment. No DataSnapshot or
head changes: linked data is evidence metadata, and charts read the confirmed
regions directly through the workbook chart input mode. The analysis source
catalogue given to the chart planner carries `linkedExperimentId`,
`linkedExperimentLabel`, `dataKind`, and header-row series
(`orientation`, `xHeaderRange`, `yValueRange`, `pointCount`) per confirmed
region.

The detail endpoint lazily returns the complete active experiment record, scalar values, series inventory/points, warnings, and exact source refs. Cross-project and inactive identities return not found.

Custom columns are shared project documentation metadata. Editors create,
rename, delete, and write bounded text cells; viewers read them through the
normal Browser projection. Definitions and values are stored separately from
immutable DataSnapshots. They participate in Browser search, filters, sort,
visibility, order, and width like ordinary projected columns. Deleting a custom
column cascades only its documentation values and never changes scientific data.

## Personal Experiment Annotations

```text
GET    /api/projects/:projectId/experiment-annotations
PUT    /api/projects/:projectId/experiments/:experimentId/annotation
DELETE /api/projects/:projectId/experiments/:experimentId/annotation
```

Each annotation is private to the authenticated user within one project. Its
payload contains a note of at most 1,000 characters and one of `amber`, `red`,
`green`, `blue`, `purple`, or `pink`. The Experiment Browser projection may
include that user's annotation on each row and may apply `starredOnly=true`
before count, cursor, and page calculation. It never exposes another user's
annotation or annotator identity. Deleting an annotation unstarrs the
experiment and does not alter ExperimentIdentity, DataSnapshot, or evidence.

## Shared Experiment Browser Configuration

```text
GET   /api/projects/:projectId/browser-config
PATCH /api/projects/:projectId/browser-config
```

Each project has at most one `labrat.projectBrowserConfig.v1` record. Every
project member reads the same configuration whenever Experiment Browser opens.
Editors, lab admins, and lab owners may update it; viewers receive `canEdit:
false`. Its payload contains only `columns`, `filters`, and `sort`. Column
entries store stable `columnId`, order, width, hidden state, and an optional
shared `labelOverride`.

`PATCH` requires `expectedVersion`. A stale version returns `409
project_browser_config_conflict`; clients reload the latest shared state rather
than silently overwriting it. This is presentation metadata only and never
changes DataSnapshots, experiment records, or source evidence. Blank label
overrides restore the projection's original label.

## Historical Personal Browser Views

```text
GET    /api/projects/:projectId/browser-views
POST   /api/projects/:projectId/browser-views
PATCH  /api/projects/:projectId/browser-views/:browserViewId
DELETE /api/projects/:projectId/browser-views/:browserViewId
```

BrowserViews remain owner-scoped historical publication/view provenance for
older clients. The active Experiment Browser no longer loads or saves them;
its live layout uses the shared project configuration above. BrowserViews must
never store authoritative scientific values.

## LabRat AgentRun

```text
GET  /api/projects/:projectId/agent/runs
POST /api/projects/:projectId/agent/runs
GET  /api/agent-runs/:agentRunId
POST /api/agent-runs/:agentRunId/cancel
```

Agent requests pass through the backend intent router and have four product
dispositions: workbook upload/region review, read-only project question
answering, read-only commentary on an already accepted chart, and reviewed
analysis planning for new charts or Experiment Browser data publication.
`selectedContext.tab` and `selectedContext.activeSurface` may carry
the current workspace surface, while `selectedContext.analysisOutputTarget`
marks an explicit workflow entry. Surface context alone never authorizes a
write: Browser publication requires a data-change intent and still creates a
reviewed `AnalysisThread` with `outputTarget: experiment_browser`. Explicit
Browser navigation may return a deterministic navigation reply, but it is not
a fallback for project questions. Requests to create charts remain chart
analysis even when sent from Browser, and display-only show/hide/filter/sort
requests do not create a DataSnapshot. Except for the explicit existing-chart
commentary workflow below, every new chart, trend calculation, comparison,
derived calculation, and explicit Excel-range chart request returns
`mode: "analysis_planning"`, creates a durable AnalysisThread, and selects only
active confirmed workbook regions.
Publishing a DataSnapshot is not required for chart planning. Unknown requests
return clarification.

The manuscript chart-assist controls send
`selectedContext.requestedWorkflow: "chart_commentary"` with an accepted
`selectedChartSpecId`, a bounded commentary mode (`analysis`, `trend`, or
`caption`), and the placement-local `selectedChartView`. The backend resolves
the project-owned accepted ChartSpec, supplies only its visible plotted traces
to the selected provider, and returns `mode: "chart_commentary"` prose. This
read-only path creates no AnalysisThread, AnalysisRun, AnalysisResult, or new
ChartSpec. Missing, cross-project, stale, or zero-visible-trace selections fail
closed with a bounded AgentRun warning.

`POST /api/projects/:projectId/agent/runs` returns user-facing text in the top-level `reply` field plus nullable `analysisThread` and `currentPlanRevision` fields. Provider configuration and credentials are backend-only. AgentRun usage stores provider, model, token, and latency metadata while planning records visible workflow steps rather than hidden chain-of-thought.

For `analysis_planning`, the backend owns drafting after the AnalysisThread has
been durably created. Closing, refreshing, timing out, or cancelling the browser
request stops that client from waiting but does not cancel the provider call.
The completed PlanRevision remains discoverable through the thread list/detail
routes. A failed draft moves the thread to `plan_failed`; thread detail returns
the persisted bounded `planFailure` copied from the owning AgentRun warning, so
the UI can distinguish a provider/validation failure from an in-progress draft.

The planning provider receives bounded catalogs of active confirmed
RegionUnderstandingRevisions and active experiment fields as ordered readable
lists. It may call `inspect_source_range` to page through workbook cells. After
plan acceptance, the code-generation provider receives a manifest plus initial
pages of materialized table/experiment inputs and may call read-only
`inspect_run_input` or `inspect_experiment_input` for additional pages. Neither
tool can execute, accept, publish, or mutate source evidence.

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
POST /api/analysis-runs/:analysisRunId/retry
GET  /api/analysis-runs/:analysisRunId
GET  /api/analysis-runs/:analysisRunId/result-preview
POST /api/analysis-runs/:analysisRunId/revise
POST /api/analysis-runs/:analysisRunId/accept-and-create-chart
POST /api/analysis-runs/:analysisRunId/accept-and-publish-experiments
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
- Each chart revision declares `inputMode: experiment_browser | workbook` in
  addition to `outputTarget`. Experiment Browser mode permits only active
  `experimentSelections`; Workbook mode permits only exact `sourceSelections`.
  The backend validates the mode and rejects mixed-source chart plans instead
  of relying on provider wording. Historical single-source plans without the
  field remain readable and infer their unambiguous mode.
- Each revision stores exact `sourceSelections`, optional active
  `experimentSelections`, structured
  `reviewPlan`, readable `displayPlan`, derived non-contiguous source
  rectangles, validation, and visible feedback. It stores no scalar field
  definitions, semantic keys, roles, Browser ids, Python, input values, expected
  result table, or user-review hash. Creating revision N marks the prior
  awaiting-review revision `superseded` without changing its payload.
- Each source selection names one accepted RegionUnderstandingRevision,
  SourceDocument, workbook name, worksheet, and exact rectangular range. One
  selection becomes one `inputs.tables` item. Selections may span multiple
  files, sheets, and non-contiguous ranges.
- Each experiment selection names one active experiment, its frozen snapshot
  head, exact zero-based `columnIndexes` from that experiment's ordered
  model-facing field list, and whether series are included.
  These selections are existing calculation inputs only; a desired new
  workbook field cannot be represented as an experiment selection. Chart plans
  cannot combine workbook and snapshot inputs. Experiment Browser publication
  plans may still use the evidence needed for their reviewed data operation.
  Internal Browser column ids are never sent to planning or code-generation
  models.
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
- Full-page pristine-project onboarding may send `executionStrategy:
  direct_source_mapping` when executing its accepted row-oriented master-table
  plan. The backend compiles the already accepted region mapping into one fixed
  policy-checked program, without a code-generation provider call or separate
  eligibility classifier. It may use only accepted fields and exact
  materialized cells, and it produces the ordinary validated AnalysisResult.
  General Browser work keeps `model_generated_python`.
- Execution verifies frozen active heads for any snapshot selections and
  materializes ordered `inputs["experiments"]` lists. Each field contains its
  original `columnIndex`, readable name, value type, unit, source summary,
  value/missing state, and exact source refs. Code generation may page selected
  experiment values with `inspect_experiment_input`.
- Only after materialization does the model generate `labrat-python-v2` with
  entrypoint `analyze(inputs, labrat)`. Programs read the dictionary
  whose `tables` and `experiments` members are ordered arrays; large inputs can
  be inspected with `inspect_run_input` and `inspect_experiment_input`.
  Python policy errors include the policy name, offending line, and reason.
- A Python execution error or backend output-contract failure may trigger one
  bounded automatic code-repair attempt inside the same immutable AnalysisRun.
  The repair receives the prior program and bounded diagnostics, cannot change
  the accepted selections or review plan, and is recorded in
  `execution.programAttempts`. Infrastructure failures are not retried.
- A running claim uses an internal token and six-minute lease. An expired claim may be recovered with a new token; an old worker cannot finalize after recovery. The claim token is never returned by public summaries.
- Python output is authoritative Plotly `{ data, layout }` plus readable
  `exclusions` and optional declared-constraint `checks`. Backend validation
  checks JSON serialization, finite values, equal non-empty x/y arrays,
  trace/point/payload limits, safe Plotly keys and strings, source ownership,
  stable unique `traceId` values, and only invariants explicitly stated in the
  reviewed plan. Missing trace ids are assigned deterministically by output
  order. The backend does not reconstruct Plotly from result rows, remap X/Y,
  require field ids, or reject one-to-many reshaping.
- For `experiment_browser`, Python instead returns top-level `columns`,
  per-record `values`, optional series patches, and readable `exclusions`.
  Each column contains only `displayName`, `valueType`, and optional `unit`;
  each scalar value references it by zero-based `columnIndex`. Python cannot
  output semantic keys, roles, target ids, internal column ids, or Browser view
  state. Every generated value references accepted workbook cell coordinates
  or selected snapshot fields. The backend validates types, finite values,
  indexes, source ownership, and payload limits, then assigns one random
  `columnId` to every validated output column and persists it in the
  AnalysisResult. All records for that output column share the same id.
  Duplicate names/types/units remain separate columns; no automatic merge or
  replacement occurs. Complete frozen active records are merged so unmentioned
  fields and series are preserved.
  Scalars of every supported value type may use source-backed `null` only with
  `formattedValue: null`, an allowed `missingReason`, and a trusted source
  pointer. Workbook source refs preserve raw/display values such as `"-"`.
  Null never means zero, does not count toward field coverage, cannot replace
  an active non-null value, and does not cause the containing experiment to be
  excluded. A later finite value may replace an active null.
- Executor or validation failure after the bounded repair records a terminal
  run status and audit event but creates no AnalysisResult, DataSnapshot, or
  ChartSpec. Repeating `execute` on a terminal run returns the original state
  with `idempotentReplay: true`.
- Generation retry is editor-only, requires an `Idempotency-Key`, and accepts
  only a terminal `failed` or `validation_failed` run. It creates a new queued
  immutable AnalysisRun against the same accepted PlanRevision, records
  `retryOfAnalysisRunId`, preserves the failed run, and performs no execution
  or publication by itself.
- Result preview returns complete validated Plotly, summary, exclusions,
  validation, and the result id needed for acceptance. It does not return the
  former technical result table, row lineage, or user-review hashes.
- Experiment Browser result preview is paginated and returns `columns`, merged
  `rows`, per-record change summaries, identity candidates, exclusions, and the
  proposed BrowserView. Its change summary includes missing value and affected
  experiment counts. It never returns Python, hashes, internal patch JSON, or
  full records to the review UI.
- Experiment publication always creates and opens a new non-default
  BrowserView derived by the backend. Model output cannot replace the user's
  existing default view. The publication-created view starts with an empty
  `selectedExperimentIds` list; publication or navigation never auto-selects
  experiments for comparison. Accepted publication creates DataSnapshot v4;
  legacy accepted snapshots remain read-only.
- Revision requires feedback only. It sends bounded prior run/result validation
  context to planning and creates a later immutable PlanRevision; prior runs and
  results remain unchanged.
- Result publication requires `editor`, an `Idempotency-Key`, the exact
  `analysisResultId`, and at least one reviewed `defaultVisibleTraceIds` value.
  Unknown or empty curve selections create no writes.
- Successful result publication atomically marks the existing AnalysisResult
  `accepted`, moves its AnalysisRun and AnalysisThread to `completed`, and
  creates one `labrat.chartSpec.v3` `origin: analysis_result` ChartSpec with
  complete authoritative Plotly, reviewed workbook and/or active-experiment
  selections, a flat trace catalog, and the reviewed default visible curves.
  Pure Experiment Browser charts are valid without workbook selections; their
  frozen snapshot heads are rechecked inside the publication transaction.
- Experiment publication requires the exact `analysisResultId`, unresolved
  identity decisions, and `Idempotency-Key`. It atomically accepts the result,
  creates one immutable `labrat.dataSnapshot.v4`, creates any reviewed
  identities, advances only affected snapshot heads, creates a new owner-scoped
  BrowserView, completes the run/thread, and records audit plus idempotency
  receipt. A changed base head returns stale preview and performs no writes.
- `LABRAT_ANALYSIS_EXECUTOR` defaults to `disabled`. `local` is non-production only; production execution requires a valid configured HTTPS hardened worker. Executor command, endpoint, timeout, and provider credentials are backend-only configuration.
- Closing the AgentRun request aborts routing or direct-answer provider work
  only before a durable analysis thread exists. Once an AnalysisThread exists,
  planning is server-owned and survives client disconnect. The frontend may
  stop observing it, then recover the same thread; it must check for an existing
  in-progress/reviewable thread before starting another planner.

Status flow:

```text
AnalysisThread planning
  -> awaiting_plan_review
  -> executing
  -> awaiting_result_review
  -> completed

AnalysisThread planning -> plan_failed (persisted bounded failure; retryable)

AnalysisPlanRevision awaiting_review -> superseded | accepted
AnalysisRun queued -> running -> failed | validation_failed | awaiting_result_review -> completed
AnalysisResult awaiting_review -> accepted
```

## Reviewed Analysis Charts

### Reusable Chart Profiles And Templates

Milestone 2 implements the following project-owned lifecycle API surface:

```text
GET  /api/projects/:projectId/chart-style-profiles
POST /api/projects/:projectId/chart-style-profiles
GET  /api/chart-style-profiles/:chartStyleProfileId
POST /api/chart-style-profiles/:chartStyleProfileId/versions
POST /api/chart-style-profiles/:chartStyleProfileId/archive

GET  /api/projects/:projectId/reusable-chart-templates
POST /api/projects/:projectId/reusable-chart-templates
GET  /api/reusable-chart-templates/:reusableChartTemplateId
POST /api/reusable-chart-templates/:reusableChartTemplateId/versions
POST /api/reusable-chart-templates/:reusableChartTemplateId/archive
```

Milestone 3 implements the application surface:

```text
POST /api/reusable-chart-template-versions/:templateVersionId/applications
```

Milestone 5 adds the read-only authoring preflight:

```text
GET  /api/chart-specs/:chartSpecId/template-eligibility
```

Reads require project viewer; writes require editor. Template creation accepts
a name, accepted source ChartSpec id, and optional accepted style-profile
version. The backend derives/validates the input contract and recipe; arbitrary
browser-authored operations are not trusted.

The ChartSpec eligibility route is a read-only backend-derived preflight. It
returns `eligible` with the bounded slot/cardinality/encoding contract or
`ineligible` with every independently actionable structured blocker; it never
creates a template. Approved
chart review uses it to fail closed before opening the template naming form.

The implemented project-state response contains bounded active profile and
template summaries; full immutable version payloads are available only from
their detail routes. Application creation requires `Idempotency-Key`, exact
experiment ids, and any explicit reviewed slot bindings. It freezes active
snapshot heads, returns
per-experiment/slot compatibility, and only when blockers are resolved creates
the deterministic accepted PlanRevision plus queued
`executionStrategy: chart_template_v1` AnalysisRun. Existing run execution,
result-preview, revise, and accept-and-create-chart routes remain authoritative.
Preview creates no ChartSpec.

When the template version's slot has `sourceKind: "linked_region"`, the same
route resolves each experiment's most recently confirmed region of the slot's
`linkedDataKind` instead of a snapshot column, reads the series once to
report shape, unit, and missing points, and returns a compatibility with
`sourceKind`, `linkedDataKind`, `excludedExperiments`, `alignment`,
`sourceSelections`, and `frozenRegionRefs` (see the workbook section of
`doc/contracts/reusable-chart-template-contract-v1.md`). `bindings` must be
empty for such templates. The accepted PlanRevision is `inputMode:
"workbook"` with one source selection per ready experiment; snapshots and
heads are untouched. Execution of these runs is not yet available and fails
closed with `chart_template_series_execution_unavailable`.

The implemented v1 fast path uses accepted active Experiment Browser scalar
fields only. It interprets the accepted scalar-selection recipe without a
model or Python and passes its Plotly result through the normal validator and
AnalysisResult review boundary.
Missing, ambiguous, incompatible-unit, unreadable-geometry, and stale-head
cases use the stable codes defined in
`doc/contracts/reusable-chart-template-contract-v1.md`. Reference-style
extraction is deferred and, when added, creates only a draft profile version.

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
