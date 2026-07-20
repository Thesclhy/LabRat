# Canonical Data Dictionary

Status: active
Last reviewed: 2026-07-20

This document defines the current scientific and workflow entities used by LabRat. Persisted JSON schema details live beside backend validators; this file defines meaning, ownership, and lineage.

## Canonical Flow

```text
FileObject
  -> SourceDocument / SourceRegion
  -> WorkbookReviewSession
  -> accepted WorkbookUnderstanding
  -> reviewed DataPlan
  -> accepted immutable DataSnapshot
  -> ExperimentIdentity + ExperimentSnapshotHead
  -> Experiment Browser row/detail
```

Charts have two reviewed branches. Explicit SourceDocument evidence flows through SourceExtractProposal/ChartProposalSet into a source-extract ChartSpec. Accepted active DataSnapshot records flow through AnalysisSelection, an immutable reviewed AnalysisPlanRevision, a validated AnalysisResult, and explicit result acceptance into an analysis-result ChartSpec. Generic DataSnapshot chart proposals outside reviewed analysis remain unimplemented.

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

Mutable conversational review state for one SourceDocument.

Contains:

- stable draft red boxes
- active red-box id
- user/assistant messages
- structured interpretation draft
- validation blockers, warnings, confidence, version, and status

Revisions apply only to the explicit active/current region unless the request intentionally updates multiple regions.

## WorkbookUnderstanding

An accepted semantic interpretation of workbook evidence.

It records facts such as:

- region purpose: experiment table, series region, metadata, ignored region
- experiment axis and source aliases
- explicit create/reuse identity decisions
- included and skipped rows
- field ids, labels, roles, value types, and units
- series x/y fields and grouping
- source refs, warnings, confidence, acknowledgements

Accepted understandings are immutable review outcomes. Corrections create a later version/session result rather than rewriting historical evidence.

## DataPlan v2

A reviewed deterministic extraction recipe.

Required semantics:

- `schemaVersion: labrat.dataPlan.v2`
- `task: experiment_browser_publish`
- `outputShape: experiment_records`
- accepted WorkbookUnderstanding/source dependencies
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

## AnalysisSelection v1

A transient, deterministic selection resolved only from accepted DataSnapshots selected by active ExperimentSnapshotHeads. It contains:

- stable experiment, snapshot, head, and record-index refs
- unit- and value-type-aware `fieldId` values
- selected scalar values and optional series points with exact source refs
- field coverage, missing counts, scalar/point counts, warnings, and blockers
- non-contiguous SourceDocument rectangles for review
- canonical dependency and selection hashes

Incompatible units produce different field ids and are never combined implicitly. Selection previews are bounded to 100,000 scalar values, 1,000,000 series points, and 100,000 expanded source cells. AnalysisSelection is not accepted scientific state and is not persisted until it is frozen into a reviewed AnalysisPlanRevision.

## AnalysisPlanRevision v1

A durable, immutable reviewable calculation proposal containing a frozen AnalysisSelection, visible processing summary, machine-readable calculation manifest, explicit missing-value policy, exact `labrat-python-v1` source/hash, and expected output/chart shape. It cannot contain authoritative result arrays. Feedback creates a later numbered revision and marks the prior awaiting-review revision superseded without modifying its payload.

## AnalysisThread v1

A project-scoped conversational workflow container for one analysis goal. It stores the original request, bounded visible messages, status, and ordered ids for plan revisions, runs, accepted results, and charts. It does not store hidden reasoning or duplicate full result arrays into project state.

## AnalysisRun v1

An immutable execution-attempt record linked to one accepted AnalysisPlanRevision. Exact-hash plan acceptance creates a `queued` run with input/program/runtime hashes and no result. Execution transactionally verifies frozen active-head refs, uses an internal claim-token lease, and rechecks accepted hashes plus Python policy before the run moves through `running` to `failed`, `validation_failed`, or `awaiting_result_review`. Bounded executor adapter/runtime/error metadata, result-preview hash, warnings, and backend validation are recorded on the attempt; internal claim tokens are never public.

## AnalysisResult v1

An append-only backend-validated output linked to one completed AnalysisRun. It contains canonical content/result-preview hashes, normalized result rows, chart traces, lineage sidecar, execution summary with explicit exclusions, exact source refs, validation, warnings, and later acceptance metadata. It begins as `awaiting_review`; executor or validation failures create no AnalysisResult. Rows, traces, relevant lineage, and source refs are paged independently through the bounded result-preview endpoint rather than project state or ordinary run detail.

## SourceExtractProposal

A reviewable bounded extraction from SourceDocument evidence for source-backed visualization. It records target document/sheet/range, proposed meaning, preview rows/series, source refs, confidence, warnings, status, and review decisions.

## ChartProposalSet

A review collection of source-backed chart proposals. Proposal acceptance/rejection is separate from ChartSpec creation.

## ChartSpec

A durable chart definition. Two evidence-backed forms are valid.

Source-backed:

- `origin: source_extract`
- chart type/title/axis fields and units
- exact source refs
- immutable `sourceSnapshot.rows` or `sourceSnapshot.series`
- optional compatible experiment ids and series metadata
- reviewed render style, axis options, warnings, and layout

Analysis-result-backed:

- `schemaVersion: labrat.chartSpec.v2` and `origin: analysis_result`
- exact thread/plan/run/result ids plus plan, selection, dependency, input, program, result, preview, and runtime hashes
- accepted input DataSnapshot/head/record refs with immutable content/dependency hashes
- a complete unique finite trace catalog with source-record lineage
- a reviewed `defaultChartView.visibleTraceIds` subset
- no copied or model-invented values outside the validated immutable AnalysisResult

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
