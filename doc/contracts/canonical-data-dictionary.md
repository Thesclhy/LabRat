# Canonical Data Dictionary

Status: active
Last reviewed: 2026-07-20

This document defines the current scientific and workflow entities used by LabRat. Persisted JSON schema details live beside backend validators; this file defines meaning, ownership, and lineage.

## Canonical Flow

```text
FileObject
  -> SourceDocument / SourceRegion
  -> WorkbookReviewSession
  -> WorkbookReviewRegion
  -> accepted RegionUnderstandingRevision
  -> reviewed DataPlan
  -> accepted immutable DataSnapshot
  -> ExperimentIdentity + ExperimentSnapshotHead
  -> Experiment Browser row/detail
```

Charts have one reviewed branch. Confirmed region evidence and/or accepted active DataSnapshot records flow through AnalysisSelection, an immutable reviewed AnalysisPlanRevision, a validated AnalysisResult, and explicit result acceptance into an analysis-result ChartSpec.

## FileObject

An immutable uploaded file owned by one project.

Required concepts:

- id, lab/project ownership
- original filename, extension, MIME type, byte size
- SHA-256 checksum
- storage provider/key
- upload actor and timestamp

## ImportRun

A workbook indexing attempt. It records scan status, structural scan result, warnings, errors, actor, and timestamps. It is not accepted scientific data.

## SourceDocument

The deterministic evidence index for one uploaded workbook.

Contains bounded metadata and summaries such as workbook type, sheets, used ranges, index version, checksum linkage, warnings, and status. Full cell grids are read through range/query APIs.

## SourceRegion

A detected or indexed workbook region with:

- source document id
- sheet name and A1 range
- zero/one-based coordinates as defined by the index implementation
- proposed kind and label
- confidence/signals/candidate fields
- exact source refs and warnings

A SourceRegion is evidence, not accepted semantic meaning.

## SourceRef

The smallest provenance pointer that lets a user reopen scientific evidence.

Typical fields:

```json
{
  "sourceDocumentId": "source_document_1",
  "sourceRegionId": "source_region_1",
  "fileObjectId": "file_1",
  "sheetName": "Runs",
  "cell": "D4",
  "range": "A1:H5",
  "rawValue": "82.4"
}
```

Derived records should keep the narrowest useful cell/range ref and may also include the containing region.

## WorkbookReviewSession

A grouping record for review activity belonging to one SourceDocument. It keeps
the workbook summary, bounded messages/warnings, version, and ownership. It does
not embed region state or have a workbook-wide accepted decision.

## WorkbookReviewRegion

A stable mutable anchor for one user- or detector-selected source range.

Contains:

- session/source-document/source-region ownership
- sheet name, A1 range, and selection method
- `active`, `ignored`, or logically `deleted` disposition
- interpretation/review status and optimistic version
- current and accepted RegionUnderstandingRevision ids
- warnings and decision actor/timestamps

Ignoring or deleting a region never erases its immutable revision history or
already-created downstream artifacts.

## RegionUnderstandingRevision

An immutable numbered semantic interpretation of one WorkbookReviewRegion.

It records the human-readable summary, typed region/experiment/field/unit/series
meaning, exact source refs, source-content and dependency hashes, validation,
provider metadata, warnings, confidence, trigger, and optional user feedback.
The backend model receives only the selected bounded range, limited neighboring
context, and workbook manifest. Feedback creates a later revision. Confirmation
moves the region's accepted pointer to one exact revision.

## DataPlan v2

A reviewed deterministic extraction recipe.

Required semantics:

- `schemaVersion: labrat.dataPlan.v2`
- `task: experiment_browser_publish`
- `outputShape: experiment_records`
- exact active accepted RegionUnderstandingRevision/source dependencies
- row- or region-oriented operations
- explicit experiment identity bindings
- field/value/unit parsing instructions
- dependency hash, validation, warnings

The plan must not embed final result arrays. Draft execution is transient until publish.

## DataSnapshot v2

An immutable accepted result of executing one DataPlan against SourceDocument evidence.

Contains:

- `schemaVersion: labrat.dataSnapshot.v2`
- accepted DataPlan id
- content hash and dependency hash
- ordered `experimentRecords[]`
- aggregate source refs, warnings, summary
- accepted actor/timestamp

Snapshots are append-only. A methodology or source change creates a new reviewed plan/snapshot.

## ExperimentRecord

One experiment result inside a DataSnapshot.

Typical shape:

```json
{
  "sourceAlias": "Exp33",
  "experimentId": "experiment_identity_33",
  "scalars": [
    {
      "fieldId": "temperature",
      "label": "Temperature",
      "role": "condition",
      "valueType": "number",
      "value": 250,
      "unit": "C",
      "headerSourceRefs": [],
      "sourceRefs": []
    }
  ],
  "series": [
    {
      "seriesId": "reaction_rate",
      "label": "Reaction rate",
      "xField": { "fieldId": "time", "unit": "min" },
      "yField": { "fieldId": "rate", "unit": "mol/g/h" },
      "points": [],
      "sourceRefs": []
    }
  ],
  "warnings": [],
  "sourceRefs": []
}
```

Scalar and series values retain typed values, raw-value context when needed, units, and exact source refs. Scalar `headerSourceRefs` preserve the accepted header interpretation separately from value-cell `sourceRefs`; grouped headers retain both parent and leaf header cells. Series may retain corresponding `xHeaderSourceRefs` and `yHeaderSourceRefs`.

## ExperimentIdentity

A stable project-owned identity with canonical label, normalized label, and aliases. Identity matching may suggest candidates, but publish requires an explicit create/reuse decision and forbids silent merges or duplicate normalized aliases.

## ExperimentSnapshotHead

The active pointer from one ExperimentIdentity to one `(dataSnapshotId, recordIndex)`. Experiment Browser reads only these heads. Publishing a partial snapshot changes only affected identities.

## Experiment Browser Projection

The Browser list is a read model, not persisted scientific truth.

One row represents one active ExperimentIdentity and includes:

- identity id and display label
- active snapshot/record refs
- bounded scalar field values
- warnings/source indicators
- stable unit-aware field catalog metadata

Large series point arrays are excluded from list responses and fetched in experiment detail.

## BrowserView

Personal display state owned by one user/project:

- name/default flag
- visible column ids/order/widths
- filters and sort
- selected experiment ids

It never stores authoritative values or changes accepted data.

## AnalysisSourceSelection v2

An exact rectangular range selected inside one active accepted
RegionUnderstandingRevision. It contains:

- stable `sourceSelectionId`
- accepted `regionUnderstandingRevisionId`
- project-owned `sourceDocumentId` and workbook name
- worksheet and canonical Excel range
- readable label and purpose

One selection becomes one materialized Python input table. Multiple files,
worksheets, and non-contiguous ranges remain separate selections. Red Source
rectangles are derived UI data rather than separately reviewed evidence.

## AnalysisPlanRevision v2

A durable immutable review proposal containing `sourceSelections`, structured
`reviewPlan`, user-readable `displayPlan`, warnings, validation, and feedback.
It contains no Python, field mapping, materialized values, result rows, traces,
Plotly, or user-review hashes. Feedback creates a later numbered revision and
marks the prior awaiting-review revision superseded without modifying it.

## AnalysisThread v1

A project-scoped conversational workflow container for one analysis goal. It stores the original request, bounded visible messages, status, and ordered ids for plan revisions, runs, accepted results, and charts. It does not store hidden reasoning or duplicate full result arrays into project state.

## AnalysisRun v2

An immutable execution-attempt record linked to one accepted PlanRevision.
Idempotent plan acceptance creates a `queued` run with no Python. Execution
re-resolves the source selections, materializes complete `inputs.tables`,
generates Python against that real input, applies policy checks, and then runs
it through the configured executor. The run records input/program/runtime
hashes, generated Python, execution phases, bounded diagnostics, warnings, and
validation; internal claim tokens are never public.

## AnalysisResult v2

An append-only backend-validated output linked to one AnalysisRun. It contains
authoritative Plotly `data/layout`, readable exclusions, declared constraint
checks, source refs, validation, warnings, internal content hashes, and later
acceptance metadata. It begins as `awaiting_review`; executor or validation
failures create no AnalysisResult. The ordinary review API returns the complete
validated Plotly payload and no technical result table or row-lineage UI.

## ChartSpec

A durable chart definition. Only the analysis-result-backed form is valid:

- `schemaVersion: labrat.chartSpec.v3` and `origin: analysis_result`
- exact thread/plan/run/result ids
- reviewed source selections and source refs
- complete authoritative Plotly `data/layout`
- a matching flat catalog of stable unique curves
- a reviewed `defaultChartView.visibleTraceIds` subset
- no values outside the validated immutable AnalysisResult

Project/list responses may omit large trace x/y arrays and set `detailRequired: true`; the ChartSpec detail endpoint returns the complete immutable artifact.

## Manuscript

A project-owned editable document containing pages, blocks, canvas state, and references. Each chart block keeps:

- the durable `chartSpecId`
- a complete immutable `chartSpecSnapshot`, loaded from detail before insertion when the list entry has `detailRequired: true`
- placement-local `chartView.visibleTraceIds`
- editable chart layout

Two blocks may reference the same ChartSpec while showing different trace subsets. Visibility changes, undo/redo, save/reload, LabRat selected-chart context, rendering, and PPTX export use the block-local view without deleting hidden traces from the stored snapshot.

## AgentRun

A visible workflow/audit trace containing status, mode, summarized tool steps, confirmable actions, linked artifact ids, warnings, and provider/model/usage metadata. It does not expose or persist hidden chain-of-thought.

## Scientific Integrity Rules

- Never invent missing scientific values, units, identities, or conversions.
- Keep incompatible units separate unless a reviewed conversion exists.
- Preserve raw evidence and exact source refs through every accepted derivation.
- Accepted data is append-only and historical outputs are not overwritten.
- AI output remains proposal/review state until deterministic validation and explicit confirmation.
- Browser publish and chart/manuscript actions are separate review boundaries.

## Retired Model

The former aggregate dataset commit, generic import/mapping collections, analysis views, and observation-series tables are not canonical entities. Migration 011 removes their database artifacts, and active APIs do not expose them.
