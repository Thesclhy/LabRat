# Canonical Data Dictionary

Status: active
Last reviewed: 2026-07-16

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

Source-backed charts branch from bounded source evidence through SourceExtractProposal and ChartSpec. DataSnapshot-backed chart planning is not implemented yet.

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

## SourceExtractProposal

A reviewable bounded extraction from SourceDocument evidence for source-backed visualization. It records target document/sheet/range, proposed meaning, preview rows/series, source refs, confidence, warnings, status, and review decisions.

## ChartProposalSet

A review collection of source-backed chart proposals. Proposal acceptance/rejection is separate from ChartSpec creation.

## ChartSpec

A durable chart definition. The currently valid form is source-backed:

- `origin: source_extract`
- chart type/title/axis fields and units
- exact source refs
- immutable `sourceSnapshot.rows` or `sourceSnapshot.series`
- optional compatible experiment ids and series metadata
- reviewed render style, axis options, warnings, and layout

Charts without an immutable source snapshot are invalid until DataSnapshot-backed charting is implemented.

## Manuscript

A project-owned editable document containing pages, blocks, canvas state, and references. Chart blocks keep `chartSpecId`, a stored `chartSpecSnapshot`, selected experiment view, and editable layout so historical figures remain renderable.

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
