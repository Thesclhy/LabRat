# Canonical Data Dictionary

This dictionary defines the concepts LabRat import, AI mapping, Experiment Browser, recompute, chart, and presentation work should use. It is intentionally broader than the current HDPE-specific fields.

## Experiment

A single run, sample, trial, or condition set that can be compared or plotted. In the current app, experiments are stored in `dataset.experiments[]` with labels such as `Exp1`. Future generic imports may create experiments from block titles, table rows, matrix columns, or approved user mappings.

Required ideas:

- stable id or label
- human-readable name
- provenance to the source block/table/row
- metadata describing conditions
- measurements produced by the experiment

## Metadata

Contextual values that describe an experiment, file, sheet, report, or block. Examples: temperature, pressure, catalyst, operator, instrument, date, solvent, sample mass.

Metadata should preserve:

- raw key
- mapped key when known
- raw value
- parsed value when safe
- unit if detected
- source reference
- confidence and warnings when uncertain

## Measurement

A recorded numeric, categorical, or time-series value produced by an experiment. Measurements can come from table cells, row records, matrix values, or calculation outputs.

Measurements should preserve:

- display name
- optional mapped field name
- value or series values
- unit
- source reference
- relationship to experiment
- optional x/y role for charting

## Import Proposal

A reviewable result produced after uploaded files are scanned, parsed, and optionally normalized. Import proposals are not committed data.

Import proposals should preserve:

- proposal id and schema version
- source file versions and scan/import run ids
- proposed experiments, metadata, measurements, and mappings
- warnings, confidence, and rationale
- provenance refs for every proposed value
- review status, such as proposed, edited, accepted, rejected, or superseded

Rules:

- Do not silently apply import proposals to the active dataset.
- Accepted proposals should create or update a dataset commit.
- Rejected proposals should remain useful context so the AI does not repeat bad suggestions.

## Dataset Commit

An immutable reviewed dataset state. A dataset commit is the answer to "what data did the browser/chart/manuscript use?"

Dataset commits should preserve:

- commit id and parent commit id when applicable
- project id or local project id
- created time and approving user or local actor
- source import proposals or recompute proposals
- experiment, metadata, and measurement records included in the commit
- summary of added, changed, and removed values
- warnings and audit refs

Current local state does not yet implement first-class dataset commits. Until it does, applied generic imports and project save/export records are the closest local approximation.

## Methodology Version

A reviewed calculation/method bundle used to derive values. Examples: carbon balance calculation, selectivity normalization, GC calibration treatment, unit conversion rule, or lab-specific Excel template semantics.

Methodology versions should preserve:

- methodology id and version id
- human-readable name and description
- formulas, calculation steps, or template references
- applicable field mappings and units
- validation rules and expected ranges
- created/approved actor and timestamp
- parent version when a method changes

Rules:

- Changing methodology must not overwrite historical results.
- Recomputed values should reference the methodology version that produced them.
- Unit conversions require explicit rules and tests before automatic use.

## Recompute Proposal

A reviewable comparison produced by applying a methodology version to existing raw or normalized data.

Recompute proposals should preserve:

- proposal id and methodology version id
- target dataset commit id
- affected experiment and measurement ids
- old values, new values, deltas, and warnings
- source refs and calculation refs for each changed value
- confidence, rationale, and review status

Accepted recompute proposals should create a new dataset commit. Rejected proposals should not alter active results.

## Provenance Graph

The trace from a committed value back to evidence and decisions.

The graph should connect:

- committed value
- measurement or metadata record
- source file version
- sheet/cell/range or instrument row
- raw value
- parser/import run
- semantic mapping
- methodology version or formula
- recompute/import proposal
- approving audit event

The current local implementation stores source refs and provenance lookup records inside dataset objects. Future backend work should make provenance queryable as a first-class graph or graph-shaped relational model.

## Audit Event

A durable record of a meaningful action.

Audit events should preserve:

- event id, actor, timestamp, project, and action type
- target ids, such as file, import run, mapping, methodology, recompute, chart, manuscript, or export
- before/after summary when values or statuses change
- rationale or user note when available

Audit events are required for cloud collaboration and useful for local reproducibility summaries.

## Semantic Mapping

A reviewed or proposed interpretation that links a generic import field to a scientific meaning LabRat can reason about. Examples: a measurement labeled `Conv %` maps to canonical field `conversion` with semantic role `response`; metadata labeled `Catalyst` maps to canonical field `catalyst` with semantic role `condition`.

Semantic mappings should preserve:

- mapping id and schema version
- source generic import ids
- referenced measurement or metadata ids
- raw label and unit
- proposed canonical field
- semantic role, such as identifier, condition, time, response, grouping, replicate, or note
- value type, such as numeric, categorical, date, text, or boolean
- confidence, rationale, warnings, and source references
- user review status, such as proposed, accepted, or rejected

Semantic mappings should not rewrite the original generic import records. Accepted mappings are an overlay that makes imported measurements more useful for chart proposals and future search.

## Chart Proposal

A reviewable chart idea derived from approved generic imports and semantic mappings. A chart proposal is not a manuscript block and should not be inserted automatically.

Chart proposals should preserve:

- proposal id and schema version
- source generic import ids
- referenced measurement, metadata, and mapping ids
- chart type
- x/y fields, labels, units, and value types
- grouping, color, or faceting suggestions where useful
- title, rationale, confidence, warnings, and source references
- review status, such as proposed, accepted, or rejected

Chart proposals should be generated from approved/imported data without inventing derived values. If a useful chart requires unit conversion, aggregation, or calculated fields, the proposal should include a warning and require explicit later implementation.

## Chart Spec

A committed or saved chart definition. A chart spec is more durable than a preview and more reproducible than a static image.

Chart specs should preserve:

- chart id and chart type
- source dataset commit id
- source methodology version id when derived values are involved
- x/y/grouping/filter field references
- labels, units, and style settings
- warnings and provenance refs
- render/export metadata

Manuscript chart blocks should eventually reference chart specs instead of only storing HDPE labels or static images.

## Source / Provenance

The trace back to original files and cells. Provenance is mandatory for scientific data changes.

Minimum source reference:

- file id or file name
- sheet name when applicable
- cell or range when applicable
- block/table id when applicable
- raw value or raw range summary

Do not discard existing LabRat provenance fields: `sources`, `files`, `rate_sources`, `calculation`, `sweep`, and `parr_data`.

## Unit

The measurement unit found in headers, metadata, or nearby labels. Examples: `min`, `h`, `C`, `bar`, `%`, `M/s`, `g`.

Rules:

- Extract units when visible.
- Keep the raw label even when unit parsing succeeds.
- If unit is inferred rather than explicit, add a warning or lower confidence.
- Do not convert units unless the conversion is explicit and test-covered.

## Warning

A human-review signal attached to a file, sheet, block, table, column, row, or value.

Examples:

- no clear header row found
- multiple possible header rows found
- unit could not be determined
- matrix orientation inferred
- mixed incompatible column types
- merged cells may affect interpretation
- skipped mostly empty rows

Warnings should be visible in import review and available to AI context.

## Confidence

A heuristic score that explains how certain the parser is. Confidence is not scientific truth.

Rules:

- Include reason strings with important confidence scores.
- Lower confidence when headers, units, regions, or orientation are ambiguous.
- Prefer `unknown` with useful warnings over confident bad parsing.

## Canonical Dataset

The approved project-level data shape used by LabRat. The current local dataset has a legacy HDPE-oriented `dataset.experiments[]` path plus generic import extensions. Future work should move toward commit-backed generic experiment, metadata, and measurement records instead of replacing HDPE fields in place.

Compatibility rule:

- Existing curated charts must keep working for HDPE records.
- Generic imports should add structured measurements and provenance without erasing current fields.
- Experiment Browser should use an adapter layer to display HDPE and generic data together or separately.

## Generic Import Dataset Extension

Current local storage keeps approved generic lab imports under `dataset.genericImports[]`. This is the current local implementation of approved imported data, not the final cloud data model.

Each generic import record should contain:

- `importId`
- `schemaVersion`
- original file metadata
- approved scan block ids
- generic `experiments[]`
- generic `measurements[]`
- `sources[]` provenance lookup records
- `files[]`
- warnings and confidence

The existing `dataset.experiments[]` array remains the curated HDPE experiment list. Generic imported measurements must not be copied into HDPE-specific fields unless a future explicit, reviewed mapping step supports that behavior.

Future direction:

- accepted imports should create dataset commits
- generic measurements should remain source-backed
- browser rows and chart specs should reference commit/methodology state when available

## Generic Mapping And Proposal Extensions

Current local storage keeps review state as additive dataset siblings, separate from raw generic imports:

- `dataset.genericMappingSets[]` for semantic mapping proposals and accepted/rejected decisions.
- `dataset.genericChartProposals[]` for chart proposal history and accepted/rejected decisions.

Compatibility rules:

- Keep `dataset.genericImports[]` as the raw approved import record with provenance.
- Keep `dataset.experiments[]` as the curated HDPE experiment list.
- Do not auto-insert chart proposals into manuscript blocks.
- Preserve rejected proposal history when useful so the AI does not repeatedly suggest the same unwanted mapping or chart.

## Experiment Browser Row

A display-oriented row derived from canonical data. Browser rows are not the source of truth; they make heterogeneous records scannable.

For HDPE records, a row can be derived from `dataset.experiments[]` and keep current columns such as catalyst loading, RPM, conversion, selectivity, carbon balance, and file pills.

For generic imports, a row should include:

- stable `rowId`
- `kind`, usually `generic`
- experiment label or name
- source file and source range
- import or mapping status
- measurement count
- warning count
- confidence
- dynamic display fields from accepted or `accepted_draft` semantic mappings
- provenance refs for the source detail view

Rules:

- Do not persist browser rows as scientific data.
- Do not flatten generic measurements into HDPE fields just to reuse the old browser table.
- Keep unmapped measurements inspectable.
- Clicking a generic row should open a generic detail view instead of HDPE-only chart/detail logic.
