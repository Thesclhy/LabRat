# AI Boundaries For LabRat

AI can help LabRat work with varied lab data, but it must not become an untraceable parser or data authority.

## Allowed AI Uses

AI may:

- propose mappings from raw column names to canonical fields
- propose mappings from metadata keys to canonical fields
- propose semantic roles such as time, condition, response, grouping, replicate, or identifier
- explain likely meaning of detected workbook structures
- summarize warnings and import-review risks
- suggest chart types from approved or reviewable structured data
- rank chart proposal candidates and explain why they are useful
- draft figure captions or manuscript prose from chart context
- help users decide which ambiguous blocks to approve or ignore
- propose dynamic Experiment Browser columns from accepted or reviewable semantic mappings
- infer likely methodology structure from user-provided templates and compact summaries
- propose recompute runs when methodology changes
- explain before/after value changes from recompute proposals
- summarize provenance for a chart, manuscript figure, or selected value
- draft commit summaries and review notes

## Disallowed AI Uses

AI must not:

- invent missing scientific values
- silently mutate `dataset.experiments`
- overwrite provenance fields
- make unit conversions unless the conversion rule is explicit and test-covered
- send full raw workbooks to model APIs
- create manuscript charts without user approval
- auto-insert chart blocks into the manuscript canvas before explicit user approval
- treat proposed mappings as accepted data before user review
- present browser-direct API-key usage as production-safe
- hide unmapped or low-confidence fields from the user
- coerce generic uploaded data into HDPE-specific fields without an explicit reviewed mapping
- silently commit imported values, mappings, methodology changes, or recomputed results
- overwrite methodology versions or historical results
- invent missing raw files, source cells, calculation steps, or audit events
- hide changed values in a recompute proposal

## AI Input Policy

Send compact summaries, not raw full files.

Good AI context:

- file and sheet names
- detected layout type and confidence
- block summaries
- candidate headers
- metadata key-value pairs
- sample rows
- units
- parser warnings
- source ranges
- approved generic import summaries
- measurement and metadata ids, labels, units, value types, coverage counts, and source references
- accepted/rejected mapping decisions when available

Avoid:

- entire workbook contents
- large raw JSON dumps
- private source files unless the user explicitly approves

## AI Output Policy

AI outputs should be proposals with confidence and rationale.

Examples:

- `Map "Conv %" to conversion_pct because header contains "Conv" and unit is %.`
- `This sheet looks like a block table because it has repeated "Experiment" titles and repeated time/conversion headers.`
- `Suggested chart: scatter Time (min) vs Conversion (%) grouped by experiment.`

AI proposals should remain separate from accepted data until user review.

AI output categories:

- `ImportProposal`
- `MappingProposal`
- `RecomputeProposal`
- `ChartProposal`
- `CaptionDraft`
- `CommitSummaryDraft`

## Mapping And Chart Proposal Rules

AI mapping and chart work should produce reviewable proposal records, not direct project mutations.

Semantic mapping proposals should include:

- referenced generic import ids and measurement/metadata ids
- proposed canonical field and semantic role
- value type and unit, if known
- confidence and rationale
- source refs where available
- warnings for missing units, sparse data, ambiguous labels, or inferred roles

Chart proposals should include:

- chart type
- x/y fields and labels
- grouping or color field, if useful
- source import ids, measurement ids, and mapping ids/proposal ids
- title, rationale, confidence, and warnings
- a clear review-required flag

Current chart proposal flows stop at displayed/reviewable proposals. Automatic manuscript chart insertion remains disallowed unless a future explicit insertion action is implemented and approved by the user.

## Semi-Automatic AI Direction

Future LabRat cloud or advanced local flows may allow high-confidence AI results to become `accepted_draft`.

Rules:

- `accepted_draft` may improve browser columns and chart suggestions.
- `accepted_draft` must remain reversible and visible.
- Final report, manuscript, or exported presentation use should make the review state clear.
- Any automatic threshold must account for confidence, warnings, unit ambiguity, sparse coverage, and prior user decisions.
- Raw imports, source refs, files, and warning records remain unchanged.
- `accepted_draft` is not a dataset commit.
- Final committed values require a human action, an audit event, and source-backed provenance.

## Methodology And Recompute Rules

AI may help identify likely formulas, changed calculation behavior, and affected fields, but methodology changes are high-risk.

Rules:

- AI may propose a methodology version from compact template summaries or user-described formulas.
- AI may explain why a value changed after deterministic recompute.
- AI must not execute or commit a recompute without user approval.
- AI must surface old values, new values, deltas, warnings, and affected experiment counts.
- AI must say when a recompute lacks enough source data or explicit conversion rules.

## Assistant Tone And Scientific Safety

The assistant should be concise, cautious, and provenance-aware.

Use language like:

- `The parsed table suggests...`
- `This mapping should be reviewed because units are missing.`
- `I do not see a source value for...`

Avoid language like:

- `The experiment proves...`
- `This value must be...`
- `I filled in the missing...`
