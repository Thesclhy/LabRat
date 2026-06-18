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
- parse a user message into a project-scoped action plan for uploads, supplemental imports, chart proposals, chart specs, or data queries
- prepare confirmable action cards that call existing reviewed APIs after the user chooses files and approves the action
- run controlled AgentRun workflows that retrieve evidence, draft Analysis Views, draft proposals, and expose visible trace steps
- search bounded source evidence and selected source ranges when the user asks source-specific questions
- estimate and report AI token/cost metadata when available

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
- execute project mutations directly from a chat message
- apply master imports, supplement imports, refreshes, chart proposal persistence, chart spec creation, or manuscript insertion without an explicit user confirmation step
- run open-ended tools outside the allowlisted LabRat evidence/proposal/execution APIs
- expose hidden chain-of-thought as the workflow trace

## AI Input Policy

Send compact summaries and selected evidence snippets, not raw full files.

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
- selected source range values when specifically retrieved by a bounded source tool
- observation series summaries
- analysis view drafts
- approved generic import summaries
- measurement and metadata ids, labels, units, value types, coverage counts, and source references
- accepted/rejected mapping decisions when available

Avoid:

- entire workbook contents
- full source cell grids
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
- `SourceExtractProposal`
- `AnalysisView`
- `AgentActionPlan`
- `AgentRun`
- `CaptionDraft`
- `CommitSummaryDraft`

## Controlled Agent Runs

Project chat should become a controlled workflow launcher. The backend may run allowlisted evidence retrieval and proposal-drafting tools, but mutating execution stays behind confirmation.

Rules:

- `POST /api/projects/:projectId/agent/runs` is the planned Agent-first workflow endpoint.
- AgentRun planning must not mutate project state.
- AgentRun visible trace steps should be concise audit/workflow summaries, not hidden chain-of-thought.
- AgentRun context should include compact project profile, dataset summaries, observation series summaries, source document/region summaries, chart/manuscript summaries, prior decisions, and selected source ranges only when needed.
- AgentRun context must not include raw workbook cell grids or full source files.
- Read-only tools may retrieve project summaries, data catalog entries, source documents, source regions, bounded source ranges, observation series, mappings, chart specs, and manuscripts.
- Drafting tools may create AnalysisView drafts, source extract proposals, chart proposals, mapping proposals, or view intents.
- Mutating tools such as import apply, proposal acceptance, ChartSpec creation, dataset promotion, and manuscript insertion require explicit user confirmation.
- AgentRun records should capture provider, model, input tokens, output tokens, estimated cost, warnings, and proposal refs when available.

## Conversational Action Planning Compatibility

The existing project chat planner remains a compatibility path that returns safe action plans.

Rules:

- `POST /api/projects/:projectId/agent/plan` must not write database rows or mutate project state.
- Planner context should include compact project profile, dataset summaries, file/import/mapping/chart/manuscript summaries, and prior decisions.
- Planner context must not include raw workbook cell grids or full source files.
- Mutating actions must be represented as confirmable action cards before execution.
- Upload actions must still use the normal file object, import run, normalization preview, relationship/refresh preview, and apply APIs.
- Chart actions may create drafts/proposals first; durable `chart_specs` still require explicit confirmation.
- Read-only data queries may run from chat, but the returned view intent remains a proposal and must reference validated project ids/source refs.

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

Future advanced flows may allow high-confidence AI results to become `accepted_draft` review aids.

Rules:

- `accepted_draft` may improve draft review surfaces and chart suggestions.
- Main Browser columns should continue to use explicit `accepted` mappings unless a separate visible draft-column mode is implemented.
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
