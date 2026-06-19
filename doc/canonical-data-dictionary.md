# Canonical Data Dictionary

This dictionary defines the shared concepts LabRat agents and code should use for imports, server project state, Experiment Browser, charting, recompute, manuscripts, and auditability. It is intentionally broader than the legacy HDPE-specific fields.

## Project

A lab-scoped research workspace. In server mode, a project is the main user-facing unit for a topic, manuscript, or experimental campaign.

Project records preserve:

- stable project id
- `lab_id`
- name, description, and status
- `current_dataset_commit_id`
- editable project context in `metadata.projectProfile`
- created/updated actor and timestamps

Logged-in workflows should load project data from `GET /api/projects/:projectId/state`.

## Project Profile

The editable experiment background for a project, stored in `projects.metadata.projectProfile`.

Project profile fields:

- `schemaVersion`
- `researchGoal`
- `experimentBackground`
- `materials`
- `methods`
- `instruments`
- `analysisNotes`
- `tags`
- `updatedAt`
- `updatedBy`

This context can be used for AI chart/mapping/caption suggestions, but it is not itself a scientific measurement table.

## File Object

An immutable uploaded raw file record.

File objects preserve:

- file id
- lab and project ids
- original file name
- extension and MIME type
- size
- checksum
- storage provider and storage key
- uploader and timestamp

Raw files should not be edited in place. A corrected workbook is a new file object and, after review, a new dataset commit.

## Import Run

A persisted review lifecycle for one uploaded file.

Import runs can hold:

- scan result
- review decisions
- normalize preview
- refresh preview context
- warnings
- status
- applied dataset commit id

Important states:

```text
review_ready -> normalized_preview -> applied
review_ready -> rejected
normalized_preview -> rejected
any valid processing failure -> failed
```

An applied import run must not be applied again.

## Import Relationship Proposal

A reviewable interpretation of how a newly normalized workbook relates to existing project data.

Relationship proposal types:

```text
supplement
replace_import
standalone_import
ignore
```

Examples:

- `Reaction_Rate_Exp30.xlsx` -> `supplement` for existing `Exp30`
- corrected master table -> `replace_import`
- unrelated new screen -> `standalone_import`

Accepted supplemental imports should create a new dataset commit with relationship metadata; they should not rewrite the target experiment values.

## Dataset Commit

An immutable reviewed dataset state. A dataset commit is the answer to "what data did the browser/chart/manuscript use?"

Dataset commits preserve:

- commit id
- lab and project ids
- parent commit id
- source import run ids
- source mapping set ids
- full `dataset_payload`
- summary of changes
- warnings
- creator and timestamp

Rules:

- Commits are immutable.
- Import apply creates a new commit.
- Refresh/Replace creates a new commit with one active import replaced.
- The commit payload stores the full accepted dataset state, not only the latest patch.
- Browser rows, chart specs, and manuscripts should reference the commit or chart spec that produced their view.

## Dataset Payload

The JSON scientific state stored in a dataset commit.

Current payload can include:

- `genericImports[]`
- legacy or curated `experiments[]` when present
- `sources[]`
- `files[]`
- warnings and compatibility fields

Review state such as mapping sets, chart proposal sets, chart specs, and manuscripts lives in separate server tables, even though local/logged-out compatibility may still store similar arrays inside a local dataset object.

## Generic Import

A source-backed normalized import inside `datasetPayload.genericImports[]`.

Generic imports preserve:

- `importId`
- schema version
- source file metadata
- approved blocks/tables/structures
- normalized `experiments[]`
- complete long-table `fields[]`
- compatibility `metadata[]` and `measurements[]` where present
- source lookup records in `sources[]`
- file records in `files[]`
- warnings and confidence
- refresh lineage metadata when replacing an older active import

Generic imports are accepted scientific data once included in a dataset commit, but they remain raw normalized evidence. Semantic mappings and chart decisions are overlays, not rewrites.

## Generic Experiment

A source-backed row, block, sample, trial, or condition set derived from a generic import.

Generic experiments preserve:

- stable experiment id
- label or human-readable name
- import id
- source block id when available
- source ref
- confidence
- warnings

For a master table, one spreadsheet row may become one generic experiment. For a block-style workbook, one block or repeated table section may become one generic experiment.

## Field Value

The primary normalized long-table record in generic imports. `fields[]` is now the preferred complete representation of imported cell values.

Field values preserve:

- field value id
- experiment id
- source field id or column id
- role
- display name
- canonical field when mapped
- raw value
- parsed value when deterministic
- unit
- row/column/source location
- source ref
- confidence
- warnings

Do not inflate `measurements[]` with conditions, identifiers, materials, or metadata. Use `fields[]` for complete Browser/detail/chart context.

## Field Role

A deterministic or reviewed category describing how a field should be used.

Current roles:

```text
identifier
material
condition
measurement
metadata
note
ignored
```

Examples:

- `Label` -> `identifier`
- `Date` -> `metadata`
- `Catalyst Type` -> `material`
- `Temperature (C)` -> `condition`
- `Selectivity Gas (%)` -> `measurement`

Roles guide Browser summaries, semantic mapping, chart proposal recipes, and AI context.

## Metadata

Contextual values that describe an experiment, file, sheet, report, block, or project.

Examples:

- date
- operator
- instrument
- project background
- notes
- reaction setup context

In generic imports, metadata-like values should still appear in `fields[]` with `role: "metadata"` and may also be mirrored into compatibility `metadata[]` if useful.

## Measurement

A value produced by an experiment that can reasonably be analyzed as an output, response, or observed result.

Examples:

- selectivity
- conversion
- yield
- rate
- concentration
- carbon number distribution value

Measurement values should preserve:

- display name
- canonical field when mapped
- value or series values
- unit
- source ref
- experiment relationship
- confidence and warnings

Only `role: "measurement"` field values should be mirrored into `measurements[]`.

## Source Ref

A stable pointer from a normalized value back to evidence.

Minimum source information:

- file id or file name
- sheet name when applicable
- cell, row, range, or block id when applicable
- raw value or raw range summary when available

Every committed scientific value should be resolvable to a source record. Do not discard existing provenance fields such as `sources`, `files`, `rate_sources`, `calculation`, `sweep`, or `parr_data`.

## Provenance Graph

The trace from a committed value back to evidence and decisions.

The graph should connect:

- committed value
- field, measurement, or metadata record
- source file object
- sheet/cell/range or instrument row
- raw value
- parser/import run
- semantic mapping
- methodology version or formula when derived
- dataset commit
- approving audit event

The current v0 implementation stores this graph mostly through JSONB payloads and source refs. Future high-volume versions may split provenance into relational or graph-shaped tables.

## Evidence Graph

The planned product-level graph of project evidence, review decisions, analysis views, and outputs. V1 does not require a graph database; explicit ids, source refs, JSONB payloads, and audit events are sufficient.

Evidence Graph nodes include:

- `FileObject`
- `SourceDocument`
- `SourceRegion`
- `SourceRange`
- `GenericImport`
- `Experiment`
- `ObservationSet`
- `ObservationSeries`
- `DatasetCommit`
- `MappingSet`
- `AnalysisView`
- `ChartProposalSet`
- `ChartSpec`
- `ManuscriptBlock`
- `AgentRun`
- `AuditEvent`

Evidence Graph edges include:

- file contains source document
- source document has source region
- source region exposes source range
- generic import creates experiments or observation sets
- observation set belongs to an experiment
- observation series is derived from observation set fields
- analysis view uses evidence nodes
- chart proposal is derived from analysis view
- chart spec is created from accepted proposal
- manuscript block snapshots chart spec
- agent run records evidence retrieval, proposals, and confirmed actions

## Source Document

An inspectable source index for an uploaded raw file, beginning with Excel workbooks. The Phase 5 backend foundation persists source document metadata and region summaries after workbook scan/import without adding full source grids to project state.

Source documents preserve:

- source document id
- project, file object, and import run refs
- document type and source index version
- sheet names, used ranges, row/column counts, and warnings
- pointer to large source index blobs when needed

Source documents are evidence records, not dataset commits.

## Source Region

A detected region inside a source document.

Source regions preserve:

- source region id
- source document and import run refs
- kind, label, sheet, Excel range, and zero-based row/column bounds
- confidence, signals, candidate fields, source refs, and warnings

Examples include `standard_table`, `block_table`, `reaction_rate_time_series`, `component_distribution`, `formula_summary`, `calibration_table`, and `unknown_region`.

Source regions are retrieval/extraction candidates. They are not accepted dataset values until a later reviewed extract or import flow promotes derived data.

## Source Range

A bounded read of source cells from a source document index.

Source ranges preserve:

- source document id
- sheet name and Excel range
- row/column/cell counts
- raw values, formatted values, formulas, cell addresses, and source refs

Range APIs must enforce cell-count caps and must not be used to send full workbooks or full source grids to model APIs.

## Source Extract Proposal

A reviewable proposal that turns a source region or bounded source range into structured rows/fields. The Phase 6 backend foundation supports generic table/range extraction and C-number/component-distribution extraction from Excel source indexes.

Source extract proposals preserve:

- proposal id
- source document and source region refs
- extract type and purpose
- preview rows/fields
- exact source refs per extracted value where possible
- status, warnings, and review decision

Accepting a source extract in v1 can draft a source-backed chart proposal set with an immutable source snapshot. It does not create a ChartSpec, insert into Manuscript, or promote values into a dataset commit by itself. Promotion into a dataset commit remains deferred.

## Observation Set

A source-backed group of related observations, usually from a supplemental workbook that adds detailed measurements to an existing experiment.

Reaction-rate supplemental workbooks currently normalize into `observationSets[]` with:

- observation set id
- kind such as `reaction_rate_time_series`
- inferred experiment label and target experiment ids
- x field, y fields, observations, summary, source sheet, confidence, and warnings

Observation sets are part of committed generic imports. They are not yet the optimized compare layer by themselves.

## Observation Series

A planned comparable series derived from an observation set and a selected x/y field pair.

Observation series preserve:

- series id
- project and dataset commit refs
- experiment id and label
- series kind
- x field and y field
- source import and observation set refs
- source refs and summary stats such as point count and x range
- status or stale decoration

Observation series are the preferred substrate for cross-experiment supplemental comparisons, such as comparing `adjusted_rate_m_s` vs `reaction_time_min` across Exp1, Exp2, and Exp3.

## Analysis View

A reviewable analysis intent between evidence retrieval and chart/table output. The first implemented subtype is `series_compare` over reaction-rate ObservationSeries; the other subtype names remain planned.

Analysis view types include:

- `series_compare`
- `source_range_extract`
- `data_table`
- `chart_ready`

Analysis Views preserve:

- analysis view id
- project and optional dataset commit refs
- view type and status
- selected evidence ids
- fields, filters, grouping, source refs, warnings, and rationale

Analysis Views are drafts/proposals; they do not mutate dataset commits.

## Agent Run

A controlled workflow trace from a user goal to retrieved evidence, drafted views/proposals, and user-confirmed execution. The Phase 7 backend foundation persists deterministic AgentRuns and supports confirmable actions for reaction-rate series comparison and source extract proposal creation.

Agent runs preserve:

- agent run id
- project, actor, message, mode, and status
- visible trace steps
- tool call summaries and observations
- analysis view/proposal/action refs
- warnings and errors
- AI provider/model/token/cost metadata when available

AgentRun traces are visible audit/workflow records, not hidden chain-of-thought. Planning may record the AgentRun and audit trace, but it must not create AnalysisViews, chart proposal sets, source extract proposals, dataset commits, ChartSpecs, or manuscript blocks until the user confirms a listed action. Confirmed actions still create reviewable artifacts and must not bypass Chart Review, Source Extract review, ChartSpec validation, or Manuscript save boundaries.

## Semantic Mapping

A reviewed or proposed interpretation that links an imported field to a scientific meaning LabRat can reason about.

Semantic mappings preserve:

- mapping id and schema version
- source import ids
- referenced field ids/source ids
- raw label and unit
- proposed canonical field
- semantic role
- value type
- confidence, rationale, warnings, and source refs
- user review status

Mappings must not rewrite raw generic import records. Accepted mappings are overlays that improve Browser columns, chart proposals, AI context, and future search.

## Mapping Set

A persisted group of semantic mapping proposals and user decisions.

Mapping sets preserve:

- mapping set id
- lab/project/import/dataset refs
- payload
- status
- decision summary
- created/updated actor and timestamps

Mapping decisions are review state; they are not dataset commits by themselves.

## Chart Proposal Set

A persisted group of reviewable chart ideas.

Chart proposal sets preserve:

- chart proposal set id
- project and dataset commit refs
- optional mapping set ref
- payload with proposals
- review status and decision summary
- origin metadata such as deterministic recipe or AI intent
- scores, rationale, warnings, and source refs

Chart proposals are not manuscript blocks. Accepted proposals should become chart specs before insertion.

## Chart Spec

A durable, validated chart definition.

Chart specs preserve:

- chart spec id
- project id
- dataset commit id for dataset-backed specs
- optional analysis view id for implemented v1.4 series-compare specs, or source extract proposal id for future source-backed specs
- source chart proposal set/proposal ids when applicable
- chart type
- title
- normalized `spec`
- layout settings
- warnings
- created/updated actor and timestamps

ChartSpec v1.3 currently supports:

```text
scatter
point
bar
grouped_bar
stacked_bar
distribution_bar
```

ChartSpec v1.4 supports analysis-view-backed compare charts over `ObservationSeries` with `seriesScope`, `compatibleExperimentIds`, and `series[]`. Source-backed charts with immutable `sourceSnapshot` rows/fields remain planned. Dataset-backed chart specs should reference source-backed fields and dataset commits. Chart specs tied to replaced dataset commits can be decorated as stale in API responses; existing manuscript chart blocks may continue rendering from their stored `chartSpecSnapshot`.

## Chart Transform

An allowlisted chart-local calculation used for preview/rendering without mutating dataset commits.

Supported transform direction:

```text
normalize_sum_to_percent
sum_fields
ratio
percent_of_total
pivot_longer
sort_components
filter_non_numeric
```

Rules:

- Transforms are part of ChartSpec, not raw dataset data.
- Transform inputs must resolve to real fields/source refs.
- `axisOptions` may request controlled axis presentation such as `linear` or `log10`.
- `renderStyle` may request controlled presentation hints such as `excel_like`, trace mode, marker/line style, grid, and legend visibility.
- Missing, zero, or non-numeric values should produce warnings.
- AI may request a transform intent, but backend must compile and validate the transform.
- Arbitrary formulas or user-supplied code are not allowed in the short-term chart system.

## Manuscript

A persisted canvas document for figures, text, references, and presentation export.

Manuscripts preserve:

- manuscript id
- project id
- title and status
- blocks
- pages
- canvas state
- references payload
- created/updated actor and timestamps

Chart blocks should reference chart specs and store a chart spec snapshot so historical figures remain renderable even when the active dataset changes.

## Experiment Browser Row

A display-oriented row derived from canonical data. Browser rows are not the source of truth.

For generic imports, a browser row can include:

- stable row id
- row kind
- experiment label
- source file and range
- import/mapping status
- field/material/condition/measurement counts
- warning count
- confidence
- accepted mapping display columns
- source refs for detail view

Rules:

- Do not persist Browser rows as scientific data.
- Do not flatten generic imports into legacy HDPE fields just to reuse old UI paths.
- Keep unmapped fields inspectable.
- Main generic Browser columns should come from explicit accepted mappings, not hidden AI guesses.
- Clicking a generic row should open source-backed generic detail rather than HDPE-only detail/chart logic.

## View Intent

A validated render intent returned by the backend for natural-language data browsing.

View intents preserve:

- view type, such as table or detail panel
- resolved experiment ids
- resolved field ids
- source refs
- title, warnings, and rationale

AI may suggest aliases, but backend must resolve them against the project data catalog before the frontend renders a view.

## Methodology Version

A reviewed calculation/method bundle used to derive values.

Examples:

- carbon balance calculation
- selectivity normalization
- GC calibration treatment
- unit conversion rule
- lab-specific Excel template semantics

Methodology versions are future work. Changing methodology must create reviewable recompute proposals and then new dataset commits rather than overwriting historical results.

## Recompute Proposal

A future reviewable comparison produced by applying a methodology version to existing raw or normalized data.

Recompute proposals should preserve:

- target dataset commit id
- methodology version id
- affected experiments and fields
- old values, new values, deltas, and warnings
- source refs and calculation refs
- confidence, rationale, and review status

Accepted recompute proposals should create a new dataset commit.

## Audit Event

A durable record of a meaningful action.

Audit events preserve:

- event id
- actor
- timestamp
- lab/project
- action type
- target ids
- summary
- safe metadata

Do not store passwords, session tokens, API keys, or unnecessary raw scientific payloads in audit metadata.

## Warning

A human-review signal attached to a file, sheet, block, table, column, row, value, mapping, chart, or manuscript state.

Examples:

- no clear header row found
- unit could not be determined
- low paired chart count
- mostly constant field
- transform skipped non-numeric values
- chart spec is stale after dataset refresh

Warnings should be visible in review surfaces and available to AI context.

## Confidence

A heuristic score that explains how certain the parser, mapper, chart proposer, or AI resolver is.

Rules:

- Confidence is not scientific truth.
- Include reasons or warnings where scores matter.
- Lower confidence when headers, units, regions, field roles, transforms, or mappings are ambiguous.
- Prefer `unknown` with useful warnings over confident bad parsing.

## Legacy Compatibility

Legacy HDPE-shaped `dataset.experiments[]`, local IndexedDB persistence, `.labrat.json` export/import, and stateless local/dev endpoints remain available for compatibility and development.

Compatibility rules:

- Existing curated HDPE charts should keep working where that path is still used.
- Generic imports should not mutate HDPE-specific fields unless a future explicit reviewed mapping supports it.
- Logged-in server mode should treat Postgres project state and dataset commits as the source of truth.
- Do not add old local-data migration layers unless explicitly requested.
