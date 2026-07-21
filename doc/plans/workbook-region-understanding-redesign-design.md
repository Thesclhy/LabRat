# Region-Level Workbook Understanding Redesign

Status: implemented 2026-07-20; final verification in progress
Date: 2026-07-20

## Purpose

Simplify Workbook Review around one auditable unit: a selected Excel region and
the user's accepted understanding of that region. A workbook review session is
only the container that groups regions belonging to one `SourceDocument`.
There is no workbook-wide semantic confirmation boundary.

The backend retains and indexes the complete workbook. A model receives only
the current bounded region, a small neighboring context window, and a bounded
workbook manifest. The complete workbook is never copied into a model prompt.

## Product Experience

The workbook remains visible on the left. The right dock lists one compact card
per review region. A card contains:

- sheet name and A1 range
- two to four short sentences describing the backend model's understanding
- model confidence and actionable warnings when needed
- one user feedback input
- `Submit revision`, `Confirm region`, and `Delete` actions
- `Ignore` when the range exists but should not become usable evidence

Activating a card focuses its range in the workbook without changing other
cards. Creating a new Excel selection immediately creates a new region card;
the backend then reads that range and drafts its initial interpretation. The
selection stage does not show experiment identities, Browser mappings, field
mapping editors, or a workbook-wide confirmation action.

## Chosen Architecture

The current aggregate `WorkbookUnderstanding` acceptance model is replaced by
independently versioned region understanding. This was selected over:

1. Keeping workbook-wide acceptance, which forces unrelated ranges through one
   confirmation boundary and creates the UI complexity being removed.
2. Storing only mutable text on each red box, which is simpler but cannot
   preserve accepted provenance or stable downstream dependencies.

The chosen model keeps immutable region revisions and one accepted-revision
pointer per region. It supports a simple UI while retaining exact source and
decision history.

## Data Model

### WorkbookReviewSession

Keep `workbook_review_sessions` as the mutable container for one project-owned
`SourceDocument`. It stores workbook summary, region ordering, bounded visible
conversation metadata, session version, and timestamps. Session status is
workflow/navigation state only; it does not accept scientific meaning.

### WorkbookReviewRegion

Add `workbook_review_regions` with:

- `id`, `lab_id`, `project_id`, `workbook_review_session_id`
- `source_document_id`, optional detected `source_region_id`
- `sheet_name`, canonical A1 `range_ref`
- `selection_method`: `detected_region` or `manual`
- `disposition`: `active`, `ignored`, or `deleted`
- `review_status`: `interpreting`, `awaiting_review`, `accepted`, or
  `interpretation_failed`
- `current_revision_id` and nullable `accepted_revision_id`
- `version`, warnings, actor, and timestamps
- nullable `ignored_at/by/reason` and `deleted_at/by/reason`

`source_document_id`, sheet, and range are backend-validated. A review region
does not replace or mutate an indexed `SourceRegion`.

### RegionUnderstandingRevision

Add immutable `region_understanding_revisions` with:

- `id`, `region_id`, monotonically increasing `revision_number`
- trigger: `initial`, `user_feedback`, or `retry`
- visible user feedback
- two-to-four-sentence `summary`
- validated structured interpretation for region purpose, experiment axis,
  headers, fields, units, inclusion, series, confidence, and warnings
- exact source refs plus source-content and dependency hashes
- bounded provider/model/token/latency metadata and validation result
- creator and timestamp

Do not store hidden model reasoning. Acceptance is recorded by the region's
`accepted_revision_id`, accepted actor/time metadata, and an audit event.

## Region Lifecycle

1. Session creation deterministically detects candidate `SourceRegion` records
   and creates corresponding review regions.
2. Region interpretation reads only the canonical selected range, bounded
   neighboring cells, workbook sheet manifest, and summaries of other regions.
3. Backend model output is parsed as strict JSON and validated against the
   indexed cells. Invalid source claims are rejected rather than persisted as
   usable interpretation.
4. A valid initial result creates revision 1 and sets `awaiting_review`.
5. `Submit revision` creates a new immutable revision from the current evidence,
   prior visible interpretation, and the user's feedback.
6. `Confirm region` accepts one exact revision using optimistic concurrency.
7. If an accepted region receives another revision, the old accepted revision
   remains usable downstream while the new current revision awaits review. A
   later confirmation atomically advances `accepted_revision_id`.
8. `Ignore` retains the card and audit history but excludes it from evidence
   retrieval and DataPlan drafting.
9. `Delete` logically deletes the review region. It disappears from the normal
   review UI and is excluded from all future planning, while raw source evidence,
   revisions, audit history, and previously accepted downstream artifacts remain
   intact.

## Model Boundary

Workbook-region interpretation uses the existing backend-only `modelProvider`.
There is no public generic AI endpoint. Region creation and revision services
own model invocation so authentication, bounds, schema validation, source
verification, and audit logging cannot be bypassed.

The model input contains:

- exact current region cells with values, formulas, merged-cell membership,
  coordinates, and source refs
- a small bounded neighboring context window
- workbook name, sheet names, used ranges, and bounded region summaries
- prior visible interpretation and current user feedback for revisions

The model output contains only a concise visible summary and structured JSON.
The backend verifies all source claims and calculates authoritative hashes.
Provider failure leaves the region in `interpretation_failed`, preserves the
selection, and allows an explicit retry. It never silently substitutes invented
semantics.

## API Contract

### Retained

```text
GET  /api/source-documents/:sourceDocumentId/regions
POST /api/source-documents/:sourceDocumentId/query
POST /api/source-documents/:sourceDocumentId/range
GET  /api/projects/:projectId/workbook-review-sessions
POST /api/projects/:projectId/workbook-review-sessions
GET  /api/workbook-review-sessions/:sessionId
```

Source range reads retain the existing backend cell bound. Progressive
full-sheet display remains a frontend composition of bounded reads.

### Added

```text
GET    /api/workbook-review-sessions/:sessionId/regions
POST   /api/workbook-review-sessions/:sessionId/regions
GET    /api/workbook-review-sessions/:sessionId/regions/:regionId
GET    /api/workbook-review-sessions/:sessionId/regions/:regionId/revisions
POST   /api/workbook-review-sessions/:sessionId/regions/:regionId/revisions
POST   /api/workbook-review-sessions/:sessionId/regions/:regionId/confirm
POST   /api/workbook-review-sessions/:sessionId/regions/:regionId/ignore
DELETE /api/workbook-review-sessions/:sessionId/regions/:regionId
GET    /api/projects/:projectId/region-understandings?status=accepted
```

Create-region requests contain `sourceDocumentId`, `sheetName`, canonicalizable
`range`, `selectionMethod`, and an idempotency key. Revision requests contain
visible feedback, `previousRevisionId`, `expectedRegionVersion`, and an
idempotency key. Confirmation identifies the exact `revisionId` and expected
region version. Ignore and delete require an expected region version and a
bounded visible reason.

### Retired

```text
POST /api/workbook-review-sessions/:sessionId/revisions
POST /api/workbook-review-sessions/:sessionId/confirm
GET  /api/projects/:projectId/workbook-understandings
```

The old aggregate `workbook_understandings` persistence and frontend API
helpers are removed in the same contract cutover. There is no dual-read,
dual-write, or development-data migration path.

### Changed In Place

Keep these route families but change their evidence dependency:

```text
POST /api/projects/:projectId/evidence/retrieve
POST /api/projects/:projectId/data-plans/draft
POST /api/projects/:projectId/data-plans/publish
```

Evidence retrieval exposes only active regions with an accepted revision as
usable evidence. DataPlan drafts reference exact
`regionUnderstandingRevisionIds` instead of `workbookUnderstandingIds`.
Dependency hashes include the immutable revision ids, source-content hashes,
and source refs. Publishing still produces accepted `DataSnapshot` records;
Experiment Browser remains Snapshot-backed.

Analysis planning and Python execution remain downstream of accepted
DataSnapshots. Region confirmation does not execute Python, publish Browser
rows, create charts, or mutate manuscript state.

## Authorization And Concurrency

- Viewer roles may read sessions, regions, revisions, and accepted summaries.
- Editor roles may create, revise, confirm, ignore, and delete regions.
- Every mutation is project-scoped and audit logged.
- `expectedRegionVersion` rejects stale updates with `409`.
- Idempotency keys make create/revise/confirm retries safe.
- Confirmation rejects revisions that are not the region's current revision.
- Logical deletion never cascades into SourceDocuments, SourceRegions,
  DataPlans, DataSnapshots, AnalysisResults, or ChartSpecs.

## Frontend State

The server is authoritative for region cards and revisions. The frontend keeps
only transient view state: active card, current workbook focus, unsent feedback,
loading/error state, and cached sheet cells. Checkbox-selected region ids and
multi-region revision composition are removed.

An optimistic card may appear immediately after manual selection, but it is
reconciled with the server-created region id. Deleting an accepted region
requires a confirmation dialog explaining that historical downstream artifacts
remain unchanged.

## Validation And Testing

Backend coverage must prove:

- project authorization and SourceDocument/session ownership
- canonical range validation and bounded source reads
- model input excludes the complete workbook and unrelated cell grids
- strict JSON/schema/source-ref validation
- immutable increasing revisions and stale-version rejection
- exact revision confirmation and accepted-pointer replacement
- old accepted revision remains usable while a later draft is pending
- ignore/delete exclusion without historical cascades
- only active accepted revisions reach evidence retrieval and DataPlan drafting
- memory/PostgreSQL parity, idempotency, and audit events

Frontend coverage must prove:

- compact cards render and focus exact workbook ranges
- manual selection creates one optimistic card and reconciles its id
- revision, retry, confirm, ignore, and delete states are isolated per card
- no checkbox list, structured interpretation editor, Browser mapping, or
  workbook-wide confirmation remains
- sheet caches and full-sheet bounded loading continue to work

The golden workflow is:

```text
upload -> detected cards -> model summaries -> manual region -> revision
-> per-region confirmation -> delete/ignore exclusion -> DataPlan preview
-> explicit publish -> Snapshot-backed Experiment Browser
```

Minimum verification is targeted frontend/backend tests, full `npm test`, full
`npm --prefix backend test`, `npm run build`, and browser QA on desktop plus a
390-pixel mobile viewport. PostgreSQL route coverage runs when
`LABRAT_TEST_DATABASE_URL` is configured.

## Non-Goals

- Sending the complete workbook to a model
- Letting the model create accepted scientific values
- Direct Python execution from region confirmation
- Redesigning Experiment Browser, AnalysisResult, ChartSpec, or Manuscript
- Migrating old development WorkbookUnderstanding records
- Adding MCP or LangChain as an orchestration dependency
